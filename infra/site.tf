# ---------------------------------------------------------------------------
# Static site: S3 (private) + CloudFront (OAC)
#
# Serves apps/site's build output — the landing, support, privacy and terms
# pages. The bucket is NOT a website endpoint and is not publicly readable:
# CloudFront reads it through an Origin Access Control, which is what buys
# https (the S3 website endpoint is http-only) and gives the future custom
# domain somewhere to attach. Content is pushed by `infra/deploy-site.sh`,
# not by Terraform — objects are artifacts, not infrastructure.
#
# The custom domain landed on 2026-09-11 (fridgeezy.com): `aliases` plus an
# ACM certificate from dns.tf, which is where the provider alias and the
# GoDaddy delegation are explained.
#
# **Only `/r/*` joined it, and the `/rest/*` half was deliberately NOT built.**
# The plan this header used to carry was one origin for site and API. What that
# missed is that the Function URL is `invoke_mode = "RESPONSE_STREAM"` and every
# AI feature in the app is SSE over it — suggest, generate, compose, modify,
# chat, substitutes. Putting those behind CloudFront changes the response path
# of the app's hottest code for no gain the app can perceive: it reads its base
# URL from `EXPO_PUBLIC_BACKEND_URL` and no user ever sees that host. CloudFront
# also applies an origin-response timeout (30s by default) between bytes, which
# a cold start plus a slow first token can reach.
#
# What genuinely needs the domain is the one URL a PERSON sees: a share link.
# So `/r/<recipeId>` is a behaviour on the API origin, rewritten to the public
# `/rest/recipes/<id>/share` route, and that path is what the app's universal
# links claim. The app keeps talking to the Function URL directly.
#
# If /rest/* is ever wanted here, the work is a second ordered_cache_behavior
# and a repointed env var — but measure a real generate stream through it first.
# ---------------------------------------------------------------------------

variable "site_bucket_name" {
  description = "Bucket holding the static site build. Globally unique."
  type        = string
  default     = "fridgeezy-site"
}

resource "aws_s3_bucket" "site" {
  bucket = var.site_bucket_name

  tags = {
    Component = "site"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project_name}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Rewrites extensionless request paths to their index object, so the pages can
# link `/support` while S3 stores `support/index.html`. Nothing else rewrites:
# a path with an extension is an asset and passes through untouched.
#
# It also does the two things the custom domain added, and both are load-bearing:
#
#  - **`/.well-known/*` is exempt from the rewrite.** Those objects have no
#    extension either, so the rule above would send Apple and Google to
#    `/.well-known/apple-app-site-association/index.html` — a key that does not
#    exist, answered 403 by S3 and mapped to the 404 page. Universal links would
#    simply never verify, with nothing in any log to say why.
#  - **www 301s to the apex, and only the apex may serve.** Apple fetches the
#    association file from the exact host in the app's entitlement and follows
#    NO redirect, so the claimed host has to be the one that answers. The
#    redirect is therefore checked BEFORE the exemption above: a request for the
#    file on www must be bounced, not served.
#
# Known limit: the redirect drops the query string. Nothing links to www with
# one today, and rebuilding it costs a loop over `request.querystring` in a
# function that runs on every request to the site.
resource "aws_cloudfront_function" "site_index_rewrite" {
  name    = "${var.project_name}-site-index-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      var host = request.headers.host ? request.headers.host.value : '';

      if (host.indexOf('www.') === 0) {
        return {
          statusCode: 301,
          statusDescription: 'Moved Permanently',
          headers: { location: { value: 'https://' + host.slice(4) + uri } }
        };
      }

      if (uri.indexOf('/.well-known/') === 0) {
        return request;
      }

      if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
      } else if (!uri.split('/').pop().includes('.')) {
        request.uri = uri + '/index.html';
      }

      return request;
    }
  EOT
}

# Turns the share link a person sees into the route the API actually serves:
# `/r/<recipeId>` -> `/rest/recipes/<recipeId>/share`.
#
# The pretty path is the point. It is what goes in an iMessage, and it is what
# the app claims in `associatedDomains`, so it wants to be short and to say
# nothing about the API's shape. The Express route is untouched.
resource "aws_cloudfront_function" "share_rewrite" {
  name    = "${var.project_name}-share-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      var id = request.uri.replace('/r/', '').replace(/\/+$/, '');

      if (!id) {
        return {
          statusCode: 302,
          statusDescription: 'Found',
          headers: { location: { value: '/' } }
        };
      }

      request.uri = '/rest/recipes/' + id + '/share';

      return request;
    }
  EOT
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} static site"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  # Empty until dns.tf has a domain, which keeps the cloudfront.net hostname
  # working either way — shipped app bundles still point at it.
  aliases = local.site_domains

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  # The API, reached only by the /r/* behaviour below. The Function URL is
  # `AuthType: NONE` by design (the Supabase token is the auth), so there is no
  # OAC to attach and nothing to sign — CloudFront is an ordinary custom origin
  # in front of it.
  origin {
    domain_name = replace(replace(aws_lambda_function_url.api.function_url, "https://", ""), "/", "")
    origin_id   = "api-lambda"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "site-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed "CachingOptimized": respects the objects' own Cache-Control,
    # which deploy-site.sh sets short for pages and long for assets.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.site_index_rewrite.arn
    }
  }

  # The share page. Dynamic per recipe and fetched by link-preview crawlers
  # (iMessage, WhatsApp, Slack) as well as by people, so it stays on the Lambda.
  #
  # Caching is off rather than tuned: the route sets no Cache-Control of its own,
  # and a cached page would keep serving a dish's old name and picture after a
  # regeneration. Give the route a Cache-Control header first if this ever shows
  # up in the Lambda's invocation count.
  #
  # `AllViewerExceptHostHeader` is the documented origin request policy for a
  # Function URL origin: everything forwarded EXCEPT Host, which must stay the
  # Lambda's own. Managed policy ids, as with the cache policy above — verify
  # with `aws cloudfront list-cache-policies --type managed` and
  # `aws cloudfront list-origin-request-policies --type managed`.
  ordered_cache_behavior {
    path_pattern           = "/r/*"
    target_origin_id       = "api-lambda"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Managed "CachingDisabled".
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # Managed "AllViewerExceptHostHeader".
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.share_rewrite.arn
    }
  }

  # S3 behind an OAC answers 403 (not 404) for a missing key, so both map to
  # the 404 page. Cached briefly: an error for a page that a deploy is about
  # to create should not outlive the deploy's invalidation by much.
  dynamic "custom_error_response" {
    for_each = [403, 404]

    content {
      error_code            = custom_error_response.value
      response_code         = 404
      response_page_path    = "/404.html"
      error_caching_min_ttl = 60
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # One block, two states: the generated certificate while there is no domain,
  # the validated ACM one once there is. Referencing the *validation* rather than
  # the certificate is what orders the apply correctly — a distribution attached
  # to an unvalidated certificate is rejected.
  viewer_certificate {
    cloudfront_default_certificate = local.site_domain_enabled ? null : true
    acm_certificate_arn            = local.site_domain_enabled ? aws_acm_certificate_validation.site[0].certificate_arn : null
    ssl_support_method             = local.site_domain_enabled ? "sni-only" : null
    minimum_protocol_version       = local.site_domain_enabled ? "TLSv1.2_2021" : null
  }

  tags = {
    Component = "site"
  }
}

data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}

output "site_bucket_name" {
  description = "Bucket deploy-site.sh syncs the build into."
  value       = aws_s3_bucket.site.bucket
}

output "site_distribution_id" {
  description = "CloudFront distribution id, for invalidations."
  value       = aws_cloudfront_distribution.site.id
}

output "site_url" {
  description = <<-EOT
    Public base URL of the site. The custom domain once there is one, so that
    deploy-site.sh builds absolute og:image URLs on the host people will see,
    and so the client's SITE_URL has one value to mirror.
  EOT
  value       = local.site_domain_enabled ? "https://${var.site_domain}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}

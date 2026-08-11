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
# When the domain arrives (TODOS: universal links), it lands here as
# `aliases` + an ACM certificate — which must live in us-east-1, the one
# CloudFront regionalism, so it will need a provider alias. The API can join
# this distribution later as an ordered_cache_behavior on /rest/* pointing at
# the Function URL, putting site and API on one origin.
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
resource "aws_cloudfront_function" "site_index_rewrite" {
  name    = "${var.project_name}-site-index-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
      } else if (!uri.split('/').pop().includes('.')) {
        request.uri = uri + '/index.html';
      }

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

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
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

  viewer_certificate {
    cloudfront_default_certificate = true
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
  description = "Public base URL of the site."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

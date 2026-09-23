# ---------------------------------------------------------------------------
# The admin console: S3 (private) + CloudFront (OAC), on its own subdomain.
#
# Same shape as site.tf and deliberately NOT the same distribution. Three
# reasons, in order of how much they matter:
#
#  - **The site's viewer-request function would break this one.** It rewrites
#    every extensionless path to `<path>/index.html`, which is right for a
#    static marketing site with one HTML file per page and wrong for a bundle
#    whose only document is at the root. Adding a path exemption to a function
#    that runs on every request to the public site is a change to the public
#    site, made for a tool nobody else can use.
#  - **Different cache rules.** The site's pages are HTML that wants five
#    minutes; this is one content-hashed bundle that wants a year, and one
#    `index.html` that must never be cached at all or a deploy is invisible.
#  - **Different blast radius.** The console can be torn down, rebuilt or
#    pointed somewhere else without touching the distribution that serves
#    fridgeezy.com and, through `/r/*`, every share link the app has ever sent.
#
# ## There is no edge authentication, and that is the design
#
# What this distribution serves is a JavaScript bundle and the Supabase ANON
# key — the same key any copy of the mobile app carries, worth nothing on its
# own under RLS. Every row the console shows comes from `/rest/admin/*`, which
# verifies a Supabase token and reads `profiles.is_admin` before answering.
# Putting a second secret in front of the bundle (a CloudFront function
# checking basic auth, a signed cookie) would protect a public artifact and add
# a credential to lose.
#
# What it DOES buy is obscurity, which is worth something and is not security:
# nothing links here, `robots` says noindex, and the hostname is the only
# thing that suggests the console exists.
#
# ## It follows `site_domain`, and gracefully has none
#
# With `site_domain` null every resource here keeps count 0 except the bucket
# and the distribution, which stay on the generated cloudfront.net hostname —
# so a stack with no domain still has a working console. See dns.tf for why
# exactly one environment may hold the domain.
# ---------------------------------------------------------------------------

variable "admin_bucket_name" {
  description = "Bucket holding the admin console build. Globally unique."
  type        = string
  default     = "fridgeezy-admin-console"
}

variable "admin_subdomain" {
  description = <<-EOT
    Host the console is served on, as a label under `site_domain`. Ignored
    when `site_domain` is null.
  EOT
  type        = string
  default     = "admin"
}

locals {
  admin_domain_enabled = local.site_domain_enabled
  admin_domain         = local.admin_domain_enabled ? "${var.admin_subdomain}.${var.site_domain}" : null

  admin_alias_records = local.admin_domain_enabled ? {
    "admin-a"    = { type = "A" }
    "admin-aaaa" = { type = "AAAA" }
  } : {}
}

resource "aws_s3_bucket" "admin" {
  bucket = var.admin_bucket_name

  tags = {
    Component = "admin"
  }
}

resource "aws_s3_bucket_public_access_block" "admin" {
  bucket = aws_s3_bucket.admin.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "admin" {
  name                              = "${var.project_name}-admin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# Certificate. us-east-1, the one CloudFront regionalism — see providers.tf.
#
# Separate from the site's rather than a third name on it: that certificate is
# attached to the distribution serving the apex and every share link, and
# adding a name to it replaces it in place. `create_before_destroy` makes that
# safe and it is still a change to the live site's TLS for the sake of a
# console.
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "admin" {
  provider = aws.us_east_1
  count    = local.admin_domain_enabled ? 1 : 0

  domain_name       = local.admin_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Component = "admin"
  }
}

resource "aws_route53_record" "admin_cert_validation" {
  for_each = {
    for dvo in(local.admin_domain_enabled ? aws_acm_certificate.admin[0].domain_validation_options : []) :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = aws_route53_zone.site[0].zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "admin" {
  provider = aws.us_east_1
  count    = local.admin_domain_enabled ? 1 : 0

  certificate_arn         = aws_acm_certificate.admin[0].arn
  validation_record_fqdns = [for record in aws_route53_record.admin_cert_validation : record.fqdn]
}

resource "aws_cloudfront_distribution" "admin" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} admin console"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  aliases = local.admin_domain_enabled ? [local.admin_domain] : []

  origin {
    domain_name              = aws_s3_bucket.admin.bucket_regional_domain_name
    origin_id                = "admin-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.admin.id
  }

  # No viewer-request function, and none is needed: the console routes on the
  # HASH, so every URL it ever produces requests `/` and the SPA reads the
  # fragment the server never sees. That is the whole reason it uses a
  # HashRouter — see `app.tsx`. The error mapping below is what covers a
  # hand-typed path.
  default_cache_behavior {
    target_origin_id       = "admin-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed "CachingOptimized": respects the objects' own Cache-Control,
    # which deploy-admin.sh sets to a year for the content-hashed bundle and to
    # no-store for index.html. Getting that second one wrong is what makes a
    # deploy invisible for as long as the TTL.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # A path that is not an object — someone typing a URL, or a stale bookmark
  # from before the hash router — is answered with the app itself at **200**,
  # not 404. The SPA then reads an empty fragment and lands on the overview,
  # which is the right destination for "I typed the hostname and something
  # extra". S3 behind an OAC answers 403 for a missing key, so both map.
  dynamic "custom_error_response" {
    for_each = [403, 404]

    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 0
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.admin_domain_enabled ? null : true
    acm_certificate_arn            = local.admin_domain_enabled ? aws_acm_certificate_validation.admin[0].certificate_arn : null
    ssl_support_method             = local.admin_domain_enabled ? "sni-only" : null
    minimum_protocol_version       = local.admin_domain_enabled ? "TLSv1.2_2021" : null
  }

  tags = {
    Component = "admin"
  }
}

resource "aws_route53_record" "admin" {
  for_each = local.admin_alias_records

  zone_id = aws_route53_zone.site[0].zone_id
  name    = local.admin_domain
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.admin.domain_name
    zone_id                = aws_cloudfront_distribution.admin.hosted_zone_id
    evaluate_target_health = false
  }
}

data "aws_iam_policy_document" "admin_bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.admin.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.admin.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "admin" {
  bucket = aws_s3_bucket.admin.id
  policy = data.aws_iam_policy_document.admin_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.admin]
}

output "admin_bucket_name" {
  description = "Bucket deploy-admin.sh syncs the console build into."
  value       = aws_s3_bucket.admin.bucket
}

output "admin_distribution_id" {
  description = "CloudFront distribution id, for invalidations."
  value       = aws_cloudfront_distribution.admin.id
}

output "admin_url" {
  description = "Where the console is served. The subdomain once there is one."
  value       = local.admin_domain_enabled ? "https://${local.admin_domain}" : "https://${aws_cloudfront_distribution.admin.domain_name}"
}

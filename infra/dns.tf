# ---------------------------------------------------------------------------
# DNS and TLS for the custom domain.
#
# fridgeezy.com is registered at GoDaddy and served by Route 53. The only
# manual step is pasting `terraform output site_nameservers` into GoDaddy's
# nameserver panel.
#
# That delegation is forced, not preferred. CloudFront publishes no stable IPs,
# so the apex needs an ALIAS record and plain DNS has no such record type —
# GoDaddy can CNAME a subdomain or HTTP-forward the apex, and nothing else. The
# apex has to be REAL because Apple fetches
# `/.well-known/apple-app-site-association` from the exact host the app claims
# in its entitlement and **follows no redirect**: a forwarded apex cannot carry
# universal links at all. Everything in apps/site and the share behaviour in
# site.tf depends on that one fact.
#
# The certificate lives in us-east-1 — the one CloudFront regionalism — which is
# what the `aws.us_east_1` provider alias exists for. Nothing else moves region.
#
# ORDER MATTERS, and a single `apply` from cold will fail. ACM validates by
# resolving a CNAME on the public internet, which cannot happen before GoDaddy
# delegates, so `aws_acm_certificate_validation` waits and then times out:
#
#   terraform apply -var-file=environments/prod.tfvars -target=aws_route53_zone.site
#   terraform output site_nameservers      # paste these into GoDaddy, wait
#   terraform apply -var-file=environments/prod.tfvars
#
# `site_domain` is set in **dev.tfvars**, which is not the mistake it looks
# like: there is one workspace and one state, it was applied from that file, and
# so every live resource — the Function URL in the app's `.env`, the distribution
# serving the site — is named `fridgeezy-dev-*`. That stack is production.
# prod.tfvars has never been applied and would rename all of it.
#
# Wherever it lives, exactly ONE environment may set it. A second environment
# with the same value requests a certificate for names it cannot validate and
# stands up a second hosted zone for one domain — and since only one nameserver
# set is delegated, that zone is silently ignored, which is worse than absent.
# With the variable null every resource here has count 0 and the distribution
# keeps its cloudfront.net hostname.
# ---------------------------------------------------------------------------

variable "site_domain" {
  description = <<-EOT
    Apex domain for the site and for share links, e.g. "fridgeezy.com". Null
    leaves the CloudFront distribution on its generated cloudfront.net hostname
    and creates no zone, certificate or records.
  EOT
  type        = string
  default     = null
}

locals {
  site_domain_enabled = var.site_domain != null

  # Both names are on the certificate and both are distribution aliases; the
  # viewer-request function 301s www to the apex, so only one host ever serves
  # a page. See site.tf for why that redirect cannot apply to /.well-known.
  site_domains = local.site_domain_enabled ? [var.site_domain, "www.${var.site_domain}"] : []

  site_alias_records = local.site_domain_enabled ? {
    "apex-a"    = { name = var.site_domain, type = "A" }
    "apex-aaaa" = { name = var.site_domain, type = "AAAA" }
    "www-a"     = { name = "www.${var.site_domain}", type = "A" }
    "www-aaaa"  = { name = "www.${var.site_domain}", type = "AAAA" }
  } : {}
}

resource "aws_route53_zone" "site" {
  count = local.site_domain_enabled ? 1 : 0

  name    = var.site_domain
  comment = "${var.project_name} site, app links and mail"

  tags = {
    Component = "site"
  }
}

# ---------------------------------------------------------------------------
# Certificate. us-east-1 regardless of var.aws_region — CloudFront reads its
# viewer certificate from nowhere else.
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "site" {
  provider = aws.us_east_1
  count    = local.site_domain_enabled ? 1 : 0

  domain_name               = var.site_domain
  subject_alternative_names = ["www.${var.site_domain}"]
  validation_method         = "DNS"

  # The distribution holds a reference to this ARN, so a renewal that replaced
  # the certificate in place would have to detach it first.
  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Component = "site"
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in(local.site_domain_enabled ? aws_acm_certificate.site[0].domain_validation_options : []) :
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

  # ACM hands both names the same record when they share a validation domain,
  # and a re-request can reissue an identical one. Overwriting is the intended
  # behaviour here rather than a conflict to fail on.
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "site" {
  provider = aws.us_east_1
  count    = local.site_domain_enabled ? 1 : 0

  certificate_arn         = aws_acm_certificate.site[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ---------------------------------------------------------------------------
# The records themselves. ALIAS, not CNAME: a CNAME at an apex is invalid, and
# an ALIAS also costs nothing to resolve.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "site" {
  for_each = local.site_alias_records

  zone_id = aws_route53_zone.site[0].zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name    = aws_cloudfront_distribution.site.domain_name
    zone_id = aws_cloudfront_distribution.site.hosted_zone_id

    # CloudFront reports no health, and asking Route 53 to evaluate it on an
    # alias to a distribution is an error rather than a no-op.
    evaluate_target_health = false
  }
}

# ---------------------------------------------------------------------------
# Mail is deliberately absent. support@fridgeezy.com has no mailbox yet, and
# the address in apps/site's privacy policy is the data-protection contact — so
# it stays pointed at a working inbox until MX records here make a new one
# real. Resend's DKIM/SPF records for transactional mail belong here too, when
# production auth mail moves off Supabase's shared sender.
# ---------------------------------------------------------------------------

output "site_nameservers" {
  description = <<-EOT
    Paste these four into GoDaddy → Domain → Nameservers → "I'll use my own".
    Delegation has to land before the certificate can validate.
  EOT
  value       = local.site_domain_enabled ? aws_route53_zone.site[0].name_servers : []
}

output "site_certificate_arn" {
  description = "Validated ACM certificate the distribution serves."
  value       = local.site_domain_enabled ? aws_acm_certificate_validation.site[0].certificate_arn : null
}

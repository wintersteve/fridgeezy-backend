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
# Mail. Two providers, because the two directions have different blockers.
#
# RECEIVING is Mailgun (EU), which is what wintersteve.com already runs — so it
# is an account and a routing model that already exists rather than a new one,
# and it works the day the domain is added. Terraform owns the MX records only:
# the domain itself and its routes are created in Mailgun's dashboard, and
# **mail bounces until that is done**, because Mailgun rejects recipients for
# domains it has never heard of. Point the MX here and nowhere else — Mailgun's
# own SPF/DKIM records are for SENDING through them, which we deliberately do
# not do, so they are absent on purpose rather than forgotten.
#
# SENDING is SES, in var.aws_region, which is the only option that lives
# entirely in this file: `aws_sesv2_email_identity` emits its own DKIM tokens,
# so there is no dashboard step and no value to paste. The catch is that the
# account is in the SES SANDBOX — 200 messages a day, one a second, and only to
# verified addresses. A production-access request was filed 2026-09-23
# (`aws sesv2 get-account --region eu-central-1` reports the review status);
# until it is granted these records are correct and unused, and Supabase auth
# mail stays on Supabase's shared sender.
#
# SPF authorises SES and nothing else. Mailgun is not included, and that is not
# an oversight: a Mailgun route FORWARDS with its own envelope sender, so
# fridgeezy.com's SPF is never consulted for it. An include costs a DNS lookup
# against the hard limit of ten and authorises a sender we do not use.
#
# NO ACCESS KEY IS CREATED HERE. The SMTP password Supabase needs is derived
# from an IAM secret access key, and `aws_iam_access_key` exposes it as
# `ses_smtp_password_v4` — which would write a live mail credential into the S3
# state, permanently, since the bucket is versioned. versions.tf states the rule
# this obeys. Terraform owns the user and its policy; the key is minted by
# `infra/create-ses-smtp-credentials.sh`, which prints it once.
# ---------------------------------------------------------------------------

locals {
  # Mail follows the domain: there is one delegated zone, so there is one place
  # mail can be configured at all. See the header in this file.
  mail_enabled = local.site_domain_enabled

  # A subdomain, so SES's bounce handling gets an envelope domain of its own and
  # the apex's SPF is not spent on it. SES publishes bounces to this MX.
  mail_from_domain = local.site_domain_enabled ? "mail.${var.site_domain}" : null

  ses_smtp_user = "${local.name_prefix}-ses-smtp"
}

# ---------------------------------------------------------------------------
# Receiving — Mailgun EU.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "mail_mx" {
  count = local.mail_enabled ? 1 : 0

  zone_id = aws_route53_zone.site[0].zone_id
  name    = var.site_domain
  type    = "MX"
  ttl     = 300

  # Equal priority on both, which is what Mailgun documents: they are a pair to
  # be tried in either order, not a primary and a fallback.
  records = [
    "10 mxa.eu.mailgun.org",
    "10 mxb.eu.mailgun.org",
  ]
}

# ---------------------------------------------------------------------------
# Sending — SES identity and its DKIM.
# ---------------------------------------------------------------------------

resource "aws_sesv2_email_identity" "mail" {
  count = local.mail_enabled ? 1 : 0

  email_identity = var.site_domain

  # Easy DKIM: SES generates and rotates the key pair and hands back three
  # tokens to publish. The alternative (BYODKIM) means holding a private key,
  # which would land in state — see the header.
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  # The DEFAULT set for this identity, which is the only way it reaches our
  # mail: a configuration set otherwise applies only to a message that names it
  # in an X-SES-CONFIGURATION-SET header, and Supabase sends plain SMTP with no
  # SES headers at all. Without this line the event destination below is wired
  # to a set nothing ever uses, and the bounce monitoring the production-access
  # request undertakes to do silently never happens.
  configuration_set_name = aws_sesv2_configuration_set.mail[0].configuration_set_name

  tags = {
    Component = "mail"
  }
}

resource "aws_route53_record" "ses_dkim" {
  count = local.mail_enabled ? 3 : 0

  zone_id = aws_route53_zone.site[0].zone_id
  name    = "${aws_sesv2_email_identity.mail[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.site_domain}"
  type    = "CNAME"
  ttl     = 300
  records = ["${aws_sesv2_email_identity.mail[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]

  # A re-verification reissues the same three tokens; overwriting is the
  # intended behaviour, the same reason cert_validation allows it.
  allow_overwrite = true
}

# ---------------------------------------------------------------------------
# Custom MAIL FROM. Without it the envelope sender is amazonses.com, so SPF and
# DMARC align on Amazon's domain rather than ours and DMARC passes only on DKIM.
# ---------------------------------------------------------------------------

resource "aws_sesv2_email_identity_mail_from_attributes" "mail" {
  count = local.mail_enabled ? 1 : 0

  email_identity   = aws_sesv2_email_identity.mail[0].email_identity
  mail_from_domain = local.mail_from_domain

  # REJECT_MESSAGE rather than USE_DEFAULT_VALUE: if the MX below ever goes
  # missing, refusing to send is better than silently falling back to
  # amazonses.com, which would break DMARC alignment without any signal.
  behavior_on_mx_failure = "REJECT_MESSAGE"

  # SES validates the MAIL FROM domain's MX when the attributes are set, so the
  # record has to exist first. Terraform cannot infer this — nothing here
  # references the record.
  depends_on = [aws_route53_record.mail_from_mx]
}

resource "aws_route53_record" "mail_from_mx" {
  count = local.mail_enabled ? 1 : 0

  zone_id = aws_route53_zone.site[0].zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 300

  # Region-specific: SES delivers bounce and complaint notifications here, and
  # the endpoint only exists in the region the identity lives in.
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  count = local.mail_enabled ? 1 : 0

  zone_id = aws_route53_zone.site[0].zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com -all"]
}

# ---------------------------------------------------------------------------
# Apex SPF and DMARC.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "spf" {
  count = local.mail_enabled ? 1 : 0

  zone_id = aws_route53_zone.site[0].zone_id
  name    = var.site_domain
  type    = "TXT"
  ttl     = 300

  # `~all` and not `-all` on the apex, unlike the MAIL FROM record above. The
  # envelope sender for our own mail is the subdomain, so this record governs
  # anything that puts fridgeezy.com in the envelope — which today is nothing
  # we control. Softfail while that is true; tighten to `-all` once DMARC
  # reports show a week with no legitimate sender missing from it.
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_route53_record" "dmarc" {
  count = local.mail_enabled ? 1 : 0

  zone_id = aws_route53_zone.site[0].zone_id
  name    = "_dmarc.${var.site_domain}"
  type    = "TXT"
  ttl     = 300

  # p=none is monitor-only and is the correct FIRST policy, not a weak one:
  # nothing has ever sent as this domain, so there is no evidence yet about what
  # a reject would break. `rua` needs a mailbox — add a Mailgun route for
  # dmarc@ alongside support@, or the reports bounce. Move to p=quarantine once
  # a fortnight of reports shows only SES.
  records = ["v=DMARC1; p=none; rua=mailto:dmarc@${var.site_domain}; fo=1"]
}

# ---------------------------------------------------------------------------
# Bounce and complaint visibility. The account-level suppression list is already
# enabled for BOUNCE and COMPLAINT, so a bad address stops being retried on its
# own; this is what makes the RATE observable rather than inferred, which is
# what the production-access request undertakes to monitor.
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "mail_events" {
  count = local.mail_enabled ? 1 : 0

  name = "${local.name_prefix}-mail-events"

  tags = {
    Component = "mail"
  }
}

resource "aws_sesv2_configuration_set" "mail" {
  count = local.mail_enabled ? 1 : 0

  configuration_set_name = "${local.name_prefix}-mail"

  delivery_options {
    # Refuse to fall back to cleartext. A sign-in code is the payload.
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }

  tags = {
    Component = "mail"
  }
}

resource "aws_sesv2_configuration_set_event_destination" "mail" {
  count = local.mail_enabled ? 1 : 0

  configuration_set_name = aws_sesv2_configuration_set.mail[0].configuration_set_name
  event_destination_name = "sns"

  event_destination {
    enabled = true

    # Deliveries are included deliberately: a bounce rate is meaningless without
    # the denominator, and SES's own console figure lags.
    matching_event_types = [
      "BOUNCE",
      "COMPLAINT",
      "REJECT",
      "DELIVERY",
      "DELIVERY_DELAY",
      "RENDERING_FAILURE",
    ]

    sns_destination {
      topic_arn = aws_sns_topic.mail_events[0].arn
    }
  }
}

# ---------------------------------------------------------------------------
# The SMTP identity Supabase authenticates as. User and policy only — see the
# header for why the key is not here.
# ---------------------------------------------------------------------------

resource "aws_iam_user" "ses_smtp" {
  count = local.mail_enabled ? 1 : 0

  name = local.ses_smtp_user
  path = "/mail/"

  tags = {
    Component = "mail"
  }
}

resource "aws_iam_user_policy" "ses_smtp" {
  count = local.mail_enabled ? 1 : 0

  name = "ses-send"
  user = aws_iam_user.ses_smtp[0].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ses:SendRawEmail"]
        Resource = "*"
        Condition = {
          # The credential can send as this domain and nothing else, so a leaked
          # key cannot be used to send as anybody. StringLike rather than a
          # fixed no-reply@ address: Supabase sends auth mail from whatever
          # sender its own config names, and pinning one here turns a settings
          # change over there into a silent 554 over here.
          StringLike = {
            "ses:FromAddress" = "*@${var.site_domain}"
          }
        }
      },
    ]
  })
}

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

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      Component   = "api"
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront reads its viewer certificate from us-east-1 and nowhere else — the
# one regionalism in the service, and the reason this alias exists at all. Its
# only user is `aws_acm_certificate.site` in dns.tf; every other resource in
# this stack stays in var.aws_region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = var.project_name
      Environment = var.environment
      Component   = "api"
      ManagedBy   = "terraform"
    }
  }
}

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # `use_lockfile` is Terraform >= 1.10's native S3 locking — no DynamoDB table.
  #
  # The bucket is created out-of-band rather than by this config, for the obvious
  # chicken-and-egg reason: a config cannot hold the state that describes its own
  # backend. `infra/README.md` ("State backend") has the three commands, and they
  # are idempotent.
  #
  # Do not put a secret into state to "make an apply simpler". This backend is
  # only safe to use because nothing sensitive reaches state any more — the
  # secrets Terraform used to read now load at cold start (see lambda.tf). S3
  # versioning means a value written here once is retained even after it is
  # removed from the current version.
  backend "s3" {
    bucket       = "fridgeezy-tfstate"
    key          = "api/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
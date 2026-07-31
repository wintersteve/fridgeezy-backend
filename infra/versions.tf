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

  # State is local for now so the first `terraform init` works with no bootstrap.
  # Before anyone else applies this, move to S3 (native locking, no DynamoDB
  # table needed on Terraform >= 1.10):
  #
  #   backend "s3" {
  #     bucket       = "fridgeezy-tfstate"
  #     key          = "api/terraform.tfstate"
  #     region       = "eu-central-1"
  #     encrypt      = true
  #     use_lockfile = true
  #   }
  #
  # See README.md ("State backend") for the bootstrap steps.
}
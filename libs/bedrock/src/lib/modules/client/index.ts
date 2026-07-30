import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";

/**
 * Region the Bedrock calls are made in. eu-central-1 serves the Claude family
 * and is where the Lambda infra is defined, so inference stays in-region.
 */
export const BEDROCK_REGION = process.env.AWS_REGION ?? "eu-central-1";

/**
 * Default text model, overridable per call and by env so a model swap doesn't
 * need a deploy of this lib.
 *
 * **Must be an inference profile ID (the `eu.` prefix), not a foundation-model
 * ID.** A bare `anthropic.claude-*` fails with *"Invocation … with on-demand
 * throughput isn't supported"*. Note that `aws bedrock list-foundation-models`
 * reports the bare form, so it is not a source for this value.
 */
export const BEDROCK_MODEL =
    process.env.BEDROCK_MODEL_ID ?? "eu.anthropic.claude-sonnet-4-6";

/**
 * Bedrock client for the Claude family.
 *
 * Unlike the OpenAI/GenAI clients there is no API key to validate at import —
 * auth comes from the AWS credential chain (an IAM role in Lambda, a profile or
 * env credentials locally), so a missing credential surfaces on the first call.
 *
 * This is deliberately the legacy `AnthropicBedrock` (`bedrock-runtime`) client
 * rather than `AnthropicBedrockMantle`: the Mantle endpoint 404/403s for every
 * model ID on this account across three regions — requests reach Anthropic and
 * are rejected, so it is an entitlement gap, not a client bug.
 */
export const bedrock = new AnthropicBedrock({ awsRegion: BEDROCK_REGION });

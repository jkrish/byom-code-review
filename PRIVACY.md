# Privacy Policy — BYOM Code Review

## What the plugin does

BYOM Code Review sends code diffs and git context from your local working tree or branch to the [OpenRouter API](https://openrouter.ai) for AI-powered code review.

## Data handling

- **Your API key**: The plugin uses your own `OPENROUTER_API_KEY` to authenticate with OpenRouter. The key is read from your local environment and is never stored, logged, or transmitted anywhere other than OpenRouter's API.
- **Code sent for review**: Git diffs, commit messages, and file contents from the selected review scope are sent to OpenRouter, which routes them to the model you choose. The plugin does not store, cache, or persist any of this data.
- **No telemetry**: The plugin does not collect analytics, usage metrics, or any telemetry data.
- **No third-party services**: Other than OpenRouter (and the downstream model provider you select), no data is sent to any external service.

## OpenRouter's privacy

Data sent to OpenRouter is subject to [OpenRouter's privacy policy](https://openrouter.ai/privacy) and the privacy policy of the model provider you select. Review these policies if you have concerns about how your code is handled upstream.

## Contact

For questions about this privacy policy, open an issue at [github.com/jkrish/byom-code-review](https://github.com/jkrish/byom-code-review/issues).

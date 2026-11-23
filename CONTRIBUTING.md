# Contributing

Install with `npm ci` and run `npm run check` before submitting a change.

Detector changes must include positive, negative, incomplete-collection, and
version-transition fixtures. They must not interpret missing input as a passing
condition. Changes to finding identity or risk require a documented migration.

Do not add source-repository mutation behavior, weaken protected-path handling,
or run untrusted repository code with write-capable credentials without a separate
design review and explicit authorization.

Keep commits focused and avoid generated activity, empty maintenance changes, or
unrelated formatting churn.

<?php

$list = static fn (string $name, array $default = []): array => array_values(array_filter(
    array_map('trim', explode(',', getenv($name) ?: implode(',', $default)))
));

$environment = strtolower(getenv('APP_ENV') ?: 'development');
$appUrl = rtrim(getenv('WIKIST_PUBLIC_URL') ?: getenv('APP_URL') ?: 'http://127.0.0.1:8899', '/');
$realtimePublicUrl = getenv('CENTRIFUGO_PUBLIC_URL') ?: preg_replace('/^http/i', 'ws', $appUrl) . '/connection/websocket';
$legacySecret = getenv('WIKIST_PASSPORT_SECRET') ?: '';
$secret = getenv('APP_SECRET') ?: ($environment === 'development' && $legacySecret !== '' ? $legacySecret : 'development-secret-change-before-deployment');
$legacyProxyEnabled = filter_var(getenv('LEGACY_NODE_PROXY') ?: 'true', FILTER_VALIDATE_BOOL);
$legacyProxyToken = getenv('LEGACY_NODE_TOKEN') ?: '';
$centrifugoEnabled = filter_var(getenv('CENTRIFUGO_ENABLED') ?: 'false', FILTER_VALIDATE_BOOL);
$centrifugoTokenSecret = getenv('CENTRIFUGO_TOKEN_HMAC_SECRET') ?: '';
$centrifugoApiKey = getenv('CENTRIFUGO_API_KEY') ?: '';
$trustedOrigins = $list('TRUSTED_ORIGINS', [$appUrl]);
if (in_array($environment, ['production', 'prod'], true)) {
    if (strlen($secret) < 32 || $secret === 'development-secret-change-before-deployment') {
        throw new RuntimeException($legacySecret !== ''
            ? 'Legacy WIKIST_PASSPORT_SECRET detected. Run the Wikist updater to migrate it to APP_SECRET.'
            : 'Production requires an APP_SECRET with at least 32 random bytes.');
    }
    if (!getenv('TRUSTED_ORIGINS')) {
        throw new RuntimeException('Production requires explicit TRUSTED_ORIGINS.');
    }
    if ($legacyProxyEnabled && strlen($legacyProxyToken) < 32) {
        throw new RuntimeException('Production legacy compatibility requires a strong LEGACY_NODE_TOKEN.');
    }
    if (!filter_var($appUrl, FILTER_VALIDATE_URL) || !str_starts_with(strtolower($appUrl), 'https://')) {
        throw new RuntimeException('Production APP_URL must be the canonical public HTTPS URL.');
    }
    foreach ($trustedOrigins as $origin) {
        $parts = parse_url($origin);
        if (str_contains($origin, '*') || strpbrk($origin, "\r\n") !== false
            || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
            || (isset($parts['path']) && !in_array($parts['path'], ['', '/'], true)) || isset($parts['query']) || isset($parts['fragment'])) {
            throw new RuntimeException('Production TRUSTED_ORIGINS must contain canonical HTTPS origins without paths or wildcards.');
        }
    }
    if ($centrifugoEnabled && (strlen($centrifugoTokenSecret) < 32 || strlen($centrifugoApiKey) < 32)) {
        throw new RuntimeException('Production realtime requires dedicated Centrifugo token and API secrets.');
    }
    if ($centrifugoEnabled) {
        $publicRealtime = parse_url((string) getenv('CENTRIFUGO_PUBLIC_URL'));
        $apiRealtime = parse_url((string) getenv('CENTRIFUGO_API_URL'));
        if (($publicRealtime['scheme'] ?? '') !== 'wss' || empty($publicRealtime['host'])) {
            throw new RuntimeException('Production CENTRIFUGO_PUBLIC_URL must use wss://.');
        }
        if (!in_array(strtolower((string) ($apiRealtime['host'] ?? '')), ['127.0.0.1', '::1', 'localhost'], true)) {
            throw new RuntimeException('CENTRIFUGO_API_URL must stay on a loopback interface.');
        }
    }
}

return [
    'name' => getenv('APP_NAME') ?: 'Wikist',
    'url' => $appUrl,
    'secret' => $secret,
    'environment' => $environment,
    'install' => [
        'bootstrap_secret' => getenv('WIKIST_INSTALL_BOOTSTRAP_SECRET') ?: '',
    ],
    'passport' => [
        'connection' => 'wikist',
        'table' => 'users',
        'roles' => ['member', 'creator', 'editor', 'senior_editor', 'admin'],
        'rehash_on_login' => filter_var(getenv('PASSPORT_REHASH_ON_LOGIN') ?: 'true', FILTER_VALIDATE_BOOL),
    ],
    'legacy_bridge' => [
        'enabled' => filter_var(getenv('WIKIST_LEGACY_BRIDGE') ?: 'true', FILTER_VALIDATE_BOOL),
        'connection' => 'wikist',
        'cookie' => getenv('WIKIST_LEGACY_COOKIE') ?: 'wikist_passport',
    ],
    'legacy_proxy' => [
        'enabled' => $legacyProxyEnabled,
        'url' => rtrim(getenv('LEGACY_NODE_URL') ?: 'http://127.0.0.1:8900', '/'),
        'token' => $legacyProxyToken,
        'timeout' => max(2, (int) (getenv('LEGACY_NODE_TIMEOUT') ?: 30)),
        'request_max_bytes' => max(1048576, (int) (getenv('LEGACY_PROXY_REQUEST_MAX_BYTES') ?: 16777216)),
        'response_max_bytes' => max(1048576, (int) (getenv('LEGACY_PROXY_RESPONSE_MAX_BYTES') ?: 16777216)),
        'request_large_max_bytes' => max(1048576, (int) (getenv('LEGACY_PROXY_REQUEST_LARGE_MAX_BYTES') ?: 268435456)),
        'response_large_max_bytes' => max(1048576, (int) (getenv('LEGACY_PROXY_RESPONSE_LARGE_MAX_BYTES') ?: 268435456)),
    ],
    'security' => [
        'trusted_origins' => $trustedOrigins,
        'trusted_proxies' => $list('TRUSTED_PROXIES', ['127.0.0.1/32', '::1/128']),
        'login_attempts' => max(3, (int) (getenv('LOGIN_ATTEMPTS_PER_MINUTE') ?: 10)),
        'captcha_attempts' => max(12, (int) (getenv('CAPTCHA_ATTEMPTS_PER_MINUTE') ?: 40)),
    ],
    'realtime' => [
        'enabled' => $centrifugoEnabled,
        'public_url' => $realtimePublicUrl,
        'ticket_ttl' => 60,
    ],
    'messaging' => [
        'enabled' => filter_var(getenv('MESSAGING_ENABLED') ?: 'true', FILTER_VALIDATE_BOOL),
        'content_root' => getenv('WIKIST_CONTENT_ROOT') ?: dirname(base_path()),
        'attachment_root' => getenv('MESSAGING_ATTACHMENT_ROOT') ?: dirname(base_path()) . '/data/uploads/messaging',
        'attachment_max_bytes' => max(1048576, (int) (getenv('MESSAGING_ATTACHMENT_MAX_BYTES') ?: 10485760)),
        'message_max_chars' => max(1000, (int) (getenv('MESSAGING_MESSAGE_MAX_CHARS') ?: 20000)),
        'withdraw_window' => max(60, (int) (getenv('MESSAGING_WITHDRAW_WINDOW') ?: 300)),
        'presence_ttl' => max(30, min(300, (int) (getenv('MESSAGING_PRESENCE_TTL') ?: 40))),
        'heartbeat_interval' => max(10, min(60, (int) (getenv('MESSAGING_HEARTBEAT_INTERVAL') ?: 15))),
        'presence_write_interval' => max(5, min(120, (int) (getenv('MESSAGING_PRESENCE_WRITE_INTERVAL') ?: 20))),
    ],
    'attachments' => [
        'user_quota_bytes' => max(16777216, (int) (getenv('ATTACHMENT_USER_QUOTA_BYTES') ?: 536870912)),
        'pending_quota_bytes' => max(4194304, (int) (getenv('ATTACHMENT_PENDING_QUOTA_BYTES') ?: 67108864)),
        'pending_count_limit' => max(1, (int) (getenv('ATTACHMENT_PENDING_COUNT_LIMIT') ?: 25)),
        'pending_ttl_seconds' => max(3600, (int) (getenv('ATTACHMENT_PENDING_TTL_SECONDS') ?: 86400)),
    ],
    'community' => [
        'enabled' => filter_var(getenv('WIKIST_COMMUNITY_ENABLED') ?: 'true', FILTER_VALIDATE_BOOL),
        'source_of_truth' => 'wikist',
        'comment_edit_window' => max(60, (int) (getenv('COMMUNITY_COMMENT_EDIT_WINDOW') ?: 300)),
        'restrict_duplicate_answers' => filter_var(getenv('COMMUNITY_RESTRICT_DUPLICATE_ANSWERS') ?: 'true', FILTER_VALIDATE_BOOL),
        'attachment_max_bytes' => max(1048576, (int) (getenv('COMMUNITY_ATTACHMENT_MAX_BYTES') ?: 12582912)),
        'attachment_root' => getenv('COMMUNITY_ATTACHMENT_ROOT') ?: '',
    ],
    'centrifugo' => [
        'enabled' => $centrifugoEnabled,
        'public_url' => $realtimePublicUrl,
        'api_url' => rtrim(getenv('CENTRIFUGO_API_URL') ?: 'http://127.0.0.1:8902/api', '/'),
        'api_key' => $centrifugoApiKey,
        'token_hmac_secret' => $centrifugoTokenSecret,
        'token_ttl' => max(60, (int) (getenv('CENTRIFUGO_TOKEN_TTL') ?: 300)),
        'subscription_ttl' => max(60, (int) (getenv('CENTRIFUGO_SUBSCRIPTION_TTL') ?: 300)),
        'connect_timeout_ms' => max(100, (int) (getenv('CENTRIFUGO_CONNECT_TIMEOUT_MS') ?: 800)),
        'timeout_ms' => max(300, (int) (getenv('CENTRIFUGO_TIMEOUT_MS') ?: 2500)),
    ],
];

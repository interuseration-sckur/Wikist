<?php

$list = static fn (string $name, array $default = []): array => array_values(array_filter(
    array_map('trim', explode(',', getenv($name) ?: implode(',', $default)))
));

return [
    'name' => getenv('APP_NAME') ?: 'Wikist',
    'url' => rtrim(getenv('APP_URL') ?: 'http://127.0.0.1:8898', '/'),
    'secret' => getenv('APP_SECRET') ?: 'development-secret-change-before-deployment',
    'passport' => [
        'connection' => 'wikist',
        'table' => 'users',
        'admin_usernames' => $list('WIKIST_ADMIN_USERNAMES', ['admin']),
        'roles' => ['member', 'creator', 'editor', 'senior_editor', 'admin'],
        'rehash_on_login' => filter_var(getenv('PASSPORT_REHASH_ON_LOGIN') ?: 'true', FILTER_VALIDATE_BOOL),
    ],
    'legacy_bridge' => [
        'enabled' => filter_var(getenv('WIKIST_LEGACY_BRIDGE') ?: 'true', FILTER_VALIDATE_BOOL),
        'connection' => 'wikist',
        'cookie' => getenv('WIKIST_LEGACY_COOKIE') ?: 'wikist_passport',
    ],
    'legacy_proxy' => [
        'enabled' => filter_var(getenv('LEGACY_NODE_PROXY') ?: 'true', FILTER_VALIDATE_BOOL),
        'url' => rtrim(getenv('LEGACY_NODE_URL') ?: 'http://127.0.0.1:8899', '/'),
        'token' => getenv('LEGACY_NODE_TOKEN') ?: '',
        'timeout' => max(2, (int) (getenv('LEGACY_NODE_TIMEOUT') ?: 30)),
    ],
    'security' => [
        'trusted_origins' => $list('TRUSTED_ORIGINS', [getenv('APP_URL') ?: 'http://127.0.0.1:8898']),
        'login_attempts' => max(3, (int) (getenv('LOGIN_ATTEMPTS_PER_MINUTE') ?: 10)),
        'captcha_attempts' => max(12, (int) (getenv('CAPTCHA_ATTEMPTS_PER_MINUTE') ?: 40)),
    ],
    'realtime' => [
        'enabled' => filter_var(getenv('CENTRIFUGO_ENABLED') ?: 'false', FILTER_VALIDATE_BOOL),
        'public_url' => getenv('CENTRIFUGO_PUBLIC_URL') ?: 'ws://127.0.0.1:8000/connection/websocket',
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
        'enabled' => filter_var(getenv('CENTRIFUGO_ENABLED') ?: 'false', FILTER_VALIDATE_BOOL),
        'public_url' => getenv('CENTRIFUGO_PUBLIC_URL') ?: 'ws://127.0.0.1:8000/connection/websocket',
        'api_url' => rtrim(getenv('CENTRIFUGO_API_URL') ?: 'http://127.0.0.1:8000/api', '/'),
        'api_key' => getenv('CENTRIFUGO_API_KEY') ?: '',
        'token_hmac_secret' => getenv('CENTRIFUGO_TOKEN_HMAC_SECRET') ?: '',
        'token_ttl' => max(60, (int) (getenv('CENTRIFUGO_TOKEN_TTL') ?: 300)),
        'subscription_ttl' => max(60, (int) (getenv('CENTRIFUGO_SUBSCRIPTION_TTL') ?: 300)),
        'connect_timeout_ms' => max(100, (int) (getenv('CENTRIFUGO_CONNECT_TIMEOUT_MS') ?: 800)),
        'timeout_ms' => max(300, (int) (getenv('CENTRIFUGO_TIMEOUT_MS') ?: 2500)),
    ],
];

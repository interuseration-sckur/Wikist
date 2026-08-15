<?php

use Webman\Session\FileSessionHandler;
use Webman\Session\RedisSessionHandler;

$driver = strtolower(getenv('SESSION_DRIVER') ?: 'file');
$lifetime = max(900, (int) (getenv('SESSION_LIFETIME') ?: 604800));
$defaultSecure = str_starts_with(strtolower(getenv('APP_URL') ?: ''), 'https://');

return [
    'type' => $driver,
    'handler' => $driver === 'redis' ? RedisSessionHandler::class : FileSessionHandler::class,
    'config' => [
        'file' => ['save_path' => runtime_path() . '/sessions'],
        'redis' => [
            'host' => getenv('REDIS_HOST') ?: '127.0.0.1',
            'port' => (int) (getenv('REDIS_PORT') ?: 6379),
            'auth' => getenv('REDIS_PASSWORD') ?: '',
            'timeout' => 2,
            'database' => (int) (getenv('REDIS_DATABASE') ?: 0),
            'prefix' => 'wikist_session:',
        ],
    ],
    'session_name' => getenv('SESSION_COOKIE') ?: 'wikist_session',
    'auto_update_timestamp' => true,
    'lifetime' => $lifetime,
    'cookie_lifetime' => $lifetime,
    'cookie_path' => '/',
    'domain' => getenv('SESSION_DOMAIN') ?: '',
    'http_only' => true,
    'secure' => filter_var(getenv('SESSION_SECURE') !== false ? getenv('SESSION_SECURE') : ($defaultSecure ? 'true' : 'false'), FILTER_VALIDATE_BOOL),
    'same_site' => getenv('SESSION_SAME_SITE') ?: 'Lax',
    'gc_probability' => [1, 1000],
];

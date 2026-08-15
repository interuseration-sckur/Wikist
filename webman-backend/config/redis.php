<?php

return [
    'default' => [
        'password' => getenv('REDIS_PASSWORD') ?: '',
        'host' => getenv('REDIS_HOST') ?: '127.0.0.1',
        'port' => (int) (getenv('REDIS_PORT') ?: 6379),
        'database' => (int) (getenv('REDIS_DATABASE') ?: 0),
        'pool' => [
            'max_connections' => (int) (getenv('REDIS_POOL_MAX') ?: 8),
            'min_connections' => 1,
            'wait_timeout' => 3,
            'idle_timeout' => 60,
            'heartbeat_interval' => 50,
        ],
    ],
];

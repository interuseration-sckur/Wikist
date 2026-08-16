<?php

$database = static function (string $prefix, string $defaultName): array {
    $driver = strtolower(getenv("{$prefix}_DB_DRIVER") ?: 'mysql');
    if ($driver === 'sqlite') {
        $path = getenv("{$prefix}_DB_DATABASE") ?: dirname(base_path()) . "/data/{$defaultName}.sqlite";
        $busyTimeout = max(1000, (int) (getenv("{$prefix}_DB_BUSY_TIMEOUT") ?: 10000));
        return [
            'driver' => 'sqlite',
            'database' => $path,
            'prefix' => '',
            'foreign_key_constraints' => true,
            'busy_timeout' => $busyTimeout,
            'journal_mode' => 'WAL',
            'synchronous' => strtolower(getenv("{$prefix}_DB_SYNCHRONOUS") ?: 'normal'),
            'options' => [PDO::ATTR_TIMEOUT => max(1, (int) ceil($busyTimeout / 1000))],
        ];
    }

    return [
        'driver' => 'mysql',
        'host' => getenv("{$prefix}_DB_HOST") ?: '127.0.0.1',
        'port' => (int) (getenv("{$prefix}_DB_PORT") ?: 3306),
        'database' => getenv("{$prefix}_DB_DATABASE") ?: $defaultName,
        'username' => getenv("{$prefix}_DB_USERNAME") ?: $defaultName,
        'password' => getenv("{$prefix}_DB_PASSWORD") ?: '',
        'charset' => 'utf8mb4',
        'collation' => 'utf8mb4_unicode_ci',
        'prefix' => '',
        'strict' => true,
        'engine' => null,
        'options' => [PDO::ATTR_EMULATE_PREPARES => false],
        'pool' => [
            'max_connections' => (int) (getenv("{$prefix}_DB_POOL_MAX") ?: 8),
            'min_connections' => (int) (getenv("{$prefix}_DB_POOL_MIN") ?: 1),
            'wait_timeout' => 3,
            'idle_timeout' => 60,
            'heartbeat_interval' => 50,
        ],
    ];
};

return [
    'default' => 'wikist',
    'connections' => [
        'wikist' => $database('WIKIST', 'wikist'),
    ],
];

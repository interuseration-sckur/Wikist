<?php

use Dotenv\Dotenv;

require dirname(__DIR__) . '/vendor/autoload.php';

if (is_file(dirname(__DIR__) . '/.env')) {
    Dotenv::createUnsafeMutable(dirname(__DIR__))->load();
}

/** @return array{pdo:PDO,driver:string} */
function wikist_database(string $prefix = 'WIKIST'): array
{
    $driver = strtolower(getenv("{$prefix}_DB_DRIVER") ?: 'sqlite');
    if ($driver === 'sqlite') {
        $database = getenv("{$prefix}_DB_DATABASE") ?: dirname(__DIR__) . '/database/wikist.sqlite';
        if (!str_starts_with($database, '/') && !preg_match('/^[A-Za-z]:[\\\\\/]/', $database)) {
            $database = dirname(__DIR__) . '/' . $database;
        }
        $directory = dirname($database);
        if (!is_dir($directory)) {
            mkdir($directory, 0770, true);
        }
        $pdo = new PDO('sqlite:' . $database);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec('PRAGMA busy_timeout = 8000');
        return ['pdo' => $pdo, 'driver' => 'sqlite'];
    }

    $host = getenv("{$prefix}_DB_HOST") ?: '127.0.0.1';
    $port = (int) (getenv("{$prefix}_DB_PORT") ?: 3306);
    $database = getenv("{$prefix}_DB_DATABASE") ?: strtolower($prefix);
    $pdo = new PDO(
        "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4",
        getenv("{$prefix}_DB_USERNAME") ?: strtolower($prefix),
        getenv("{$prefix}_DB_PASSWORD") ?: '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
    );
    return ['pdo' => $pdo, 'driver' => 'mysql'];
}

#!/usr/bin/env php
<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

if (PHP_VERSION_ID < 80100) {
    fwrite(STDERR, "Wikist 1.0 update.php requires PHP 8.1 or newer.\n");
    exit(1);
}

$root = __DIR__;
$backend = $root . DIRECTORY_SEPARATOR . 'webman-backend';
$options = [
    'dryRun' => false,
    'backup' => true,
    'check' => true,
    'from' => '',
];

foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--dry-run') {
        $options['dryRun'] = true;
    } elseif ($argument === '--no-backup') {
        $options['backup'] = false;
    } elseif ($argument === '--skip-check') {
        $options['check'] = false;
    } elseif (str_starts_with($argument, '--from=')) {
        $options['from'] = trim(substr($argument, 7));
    } elseif ($argument === '--help' || $argument === '-h') {
        echo <<<'TEXT'
Wikist database maintenance

Usage:
  php update.php [--dry-run] [--no-backup] [--skip-check] [--from=VERSION]

Options:
  --dry-run     Show the database driver and pending migrations without changing data.
  --no-backup   Skip the SQLite pre-migration snapshot. Use only after another verified backup.
  --skip-check  Skip the Webman foundation check after migration.
  --from=...    Record the previous Wikist version in the update report.

Use `npm run update -- ...` when code also needs to be fetched. That orchestrator
creates the full-site backup and calls this script for database maintenance.
TEXT;
        echo PHP_EOL;
        exit(0);
    } else {
        fwrite(STDERR, "Unknown option: {$argument}\n");
        exit(2);
    }
}

/** @return never */
function wikist_update_fail(string $message, int $code = 1): void
{
    throw new RuntimeException($message, $code);
}

function wikist_update_run(array $command, string $cwd): void
{
    $process = proc_open($command, [0 => STDIN, 1 => STDOUT, 2 => STDERR], $pipes, $cwd);
    if (!is_resource($process)) {
        wikist_update_fail('Unable to start the Wikist maintenance process.');
    }
    $exitCode = proc_close($process);
    if ($exitCode !== 0) {
        wikist_update_fail('Maintenance command failed with exit code ' . $exitCode . '.');
    }
}

function wikist_update_report(string $directory, array $report): string
{
    if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
        wikist_update_fail('Unable to create update report directory.');
    }
    $stamp = preg_replace('/[^0-9TZ-]+/', '-', (string) ($report['startedAt'] ?? gmdate('c')));
    $path = $directory . DIRECTORY_SEPARATOR . 'php-update-' . $stamp . '.json';
    $json = json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || file_put_contents($path, $json . PHP_EOL, LOCK_EX) === false) {
        wikist_update_fail('Unable to write the update report.');
    }
    file_put_contents($directory . DIRECTORY_SEPARATOR . 'php-latest.json', $json . PHP_EOL, LOCK_EX);
    return $path;
}

function wikist_update_migration_state(PDO $pdo, array $files): array
{
    $hasTable = false;
    try {
        $driver = (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            $statement = $pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'webman_migrations'");
            $hasTable = (bool) $statement?->fetchColumn();
        } else {
            $statement = $pdo->query("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'webman_migrations'");
            $hasTable = (bool) $statement?->fetchColumn();
        }
    } catch (Throwable) {
        $hasTable = false;
    }
    $applied = $hasTable
        ? array_map('strval', $pdo->query('SELECT migration FROM webman_migrations ORDER BY migration')?->fetchAll(PDO::FETCH_COLUMN) ?: [])
        : [];
    $available = array_map(static fn (string $file): string => pathinfo($file, PATHINFO_FILENAME), $files);
    $pending = array_values(array_diff($available, $applied));
    return [
        'foundationApplied' => in_array('0001_passport_foundation', $applied, true),
        'applied' => $applied,
        'pending' => $pending,
    ];
}

function wikist_update_sqlite_backup(PDO $pdo, string $root): ?array
{
    $rows = $pdo->query('PRAGMA database_list')?->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $database = '';
    foreach ($rows as $row) {
        if (($row['name'] ?? '') === 'main') {
            $database = (string) ($row['file'] ?? '');
            break;
        }
    }
    if ($database === '' || !is_file($database)) {
        return null;
    }
    $directory = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'backups';
    if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
        wikist_update_fail('Unable to create database backup directory.');
    }
    $stamp = gmdate('Y-m-d\TH-i-s\Z');
    $destination = $directory . DIRECTORY_SEPARATOR . "wikist-db-pre-1.0-{$stamp}.sqlite";
    $pdo->exec('PRAGMA wal_checkpoint(FULL)');
    $quoted = str_replace("'", "''", $destination);
    $pdo->exec("VACUUM INTO '{$quoted}'");
    if (!is_file($destination) || filesize($destination) === 0) {
        wikist_update_fail('SQLite backup verification failed.');
    }
    return [
        'path' => $destination,
        'bytes' => filesize($destination),
        'sha256' => hash_file('sha256', $destination),
    ];
}

$package = json_decode((string) @file_get_contents($root . DIRECTORY_SEPARATOR . 'package.json'), true);
$version = is_array($package) ? (string) ($package['version'] ?? 'unknown') : 'unknown';
$reportDirectory = $root . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'updates';
$report = [
    'status' => 'running',
    'startedAt' => gmdate('c'),
    'versionFrom' => $options['from'],
    'versionTo' => $version,
    'dryRun' => $options['dryRun'],
    'backup' => null,
    'databaseDriver' => '',
    'before' => null,
    'after' => null,
];

try {
    $autoload = $backend . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';
    if (!is_file($autoload)) {
        wikist_update_fail('Composer dependencies are missing. Run composer install in webman-backend first.');
    }
    require_once $backend . DIRECTORY_SEPARATOR . 'tools' . DIRECTORY_SEPARATOR . 'database.php';

    if (!getenv('WIKIST_DB_DATABASE')) {
        $sitePath = $root . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'site.config.json';
        $site = is_file($sitePath) ? json_decode((string) file_get_contents($sitePath), true) : [];
        $database = is_array($site) ? (string) ($site['passport']['database'] ?? 'data/wikist.sqlite') : 'data/wikist.sqlite';
        $absolute = str_starts_with($database, '/') || preg_match('/^[A-Za-z]:[\\\\\/]/', $database)
            ? $database
            : $root . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $database);
        putenv('WIKIST_DB_DATABASE=' . $absolute);
    }
    if (!getenv('WIKIST_DB_DRIVER')) {
        putenv('WIKIST_DB_DRIVER=sqlite');
    }

    $migrationFiles = glob($backend . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'migrations' . DIRECTORY_SEPARATOR . '*.php') ?: [];
    sort($migrationFiles, SORT_STRING);
    $configuredDriver = strtolower((string) (getenv('WIKIST_DB_DRIVER') ?: 'sqlite'));
    if ($options['dryRun'] && $configuredDriver === 'sqlite') {
        $configuredDatabase = (string) getenv('WIKIST_DB_DATABASE');
        $resolvedDatabase = str_starts_with($configuredDatabase, '/') || preg_match('/^[A-Za-z]:[\\\\\/]/', $configuredDatabase)
            ? $configuredDatabase
            : $backend . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $configuredDatabase);
        if (!is_file($resolvedDatabase)) {
            $report['databaseDriver'] = 'sqlite';
            $report['before'] = [
                'foundationApplied' => false,
                'applied' => [],
                'pending' => array_map(static fn (string $file): string => pathinfo($file, PATHINFO_FILENAME), $migrationFiles),
            ];
            echo "Wikist {$version} database: sqlite (not initialized)" . PHP_EOL;
            echo "Pending migrations: " . implode(', ', $report['before']['pending']) . PHP_EOL;
            echo "Dry run complete; no database changes were made." . PHP_EOL;
            exit(0);
        }
    }

    ['pdo' => $pdo, 'driver' => $driver] = wikist_database();
    $report['databaseDriver'] = $driver;
    $report['before'] = wikist_update_migration_state($pdo, $migrationFiles);

    echo "Wikist {$version} database: {$driver}" . PHP_EOL;
    echo $report['before']['pending'] === []
        ? "No pending migrations." . PHP_EOL
        : "Pending migrations: " . implode(', ', $report['before']['pending']) . PHP_EOL;

    if ($options['dryRun']) {
        $report['status'] = 'dry-run';
        $report['finishedAt'] = gmdate('c');
        echo "Dry run complete; no database changes were made." . PHP_EOL;
        exit(0);
    }

    if ($options['backup']) {
        if ($driver !== 'sqlite') {
            wikist_update_fail('Automatic update.php backup is available for SQLite only. Create and verify a MySQL backup, then rerun with --no-backup.');
        }
        $report['backup'] = wikist_update_sqlite_backup($pdo, $root);
        if ($report['backup']) {
            echo "Verified backup: {$report['backup']['path']}" . PHP_EOL;
        }
    }
    $pdo = null;

    wikist_update_run([PHP_BINARY, $backend . DIRECTORY_SEPARATOR . 'tools' . DIRECTORY_SEPARATOR . 'migrate.php'], $backend);
    if ($options['check']) {
        wikist_update_run([PHP_BINARY, $backend . DIRECTORY_SEPARATOR . 'tools' . DIRECTORY_SEPARATOR . 'check.php'], $backend);
    }

    ['pdo' => $pdo] = wikist_database();
    $report['after'] = wikist_update_migration_state($pdo, $migrationFiles);
    if ($report['after']['pending'] !== [] || !$report['after']['foundationApplied']) {
        wikist_update_fail('Database migration verification found unapplied changes.');
    }
    $report['status'] = 'ok';
    $report['finishedAt'] = gmdate('c');
    $path = wikist_update_report($reportDirectory, $report);
    echo "Wikist database update complete. Report: {$path}" . PHP_EOL;
} catch (Throwable $error) {
    $report['status'] = 'failed';
    $report['error'] = $error->getMessage();
    $report['finishedAt'] = gmdate('c');
    try {
        $path = wikist_update_report($reportDirectory, $report);
        fwrite(STDERR, "Update failed. Report: {$path}" . PHP_EOL);
    } catch (Throwable) {
        // Keep the original maintenance failure visible if reporting also fails.
    }
    fwrite(STDERR, $error->getMessage() . PHP_EOL);
    exit($error->getCode() > 0 && $error->getCode() < 256 ? $error->getCode() : 1);
}

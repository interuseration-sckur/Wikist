<?php

require __DIR__ . '/database.php';

$scope = 'all';
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--urls') $scope = 'urls';
    elseif ($argument === '--sqlite') $scope = 'sqlite';
    elseif ($argument === '--all') $scope = 'all';
    elseif ($argument === '--help' || $argument === '-h') {
        echo "Usage: php tools/doctor.php [--all|--urls|--sqlite]\n";
        exit(0);
    } else {
        fwrite(STDERR, "Unknown option: {$argument}\n");
        exit(2);
    }
}

['pdo' => $pdo, 'driver' => $driver] = wikist_database();
$root = dirname(__DIR__, 2);
$checks = [];
$record = static function (string $name, bool $ok, string $detail = '', string $severity = 'error') use (&$checks): void {
    $checks[] = ['name' => $name, 'ok' => $ok, 'severity' => $ok ? 'ok' : $severity, 'detail' => $detail];
};

try {
    $pdo->query('SELECT 1')->fetchColumn();
    $record('database.connection', true, $driver);
} catch (Throwable $error) {
    $record('database.connection', false, $error->getMessage());
}

foreach (['users', 'webman_migrations', 'messaging_conversations', 'knowledge_objects', 'community_questions'] as $table) {
    if ($driver === 'sqlite') {
        $statement = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
        $statement->execute([$table]);
    } else {
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?');
        $statement->execute([$table]);
    }
    $record("schema.{$table}", (bool) $statement->fetchColumn());
}

$requiredTriggers = [
    'trg_users_role_insert', 'trg_users_role_update', 'trg_users_status_insert', 'trg_users_status_update',
    'trg_users_last_admin_update', 'trg_users_last_admin_delete', 'trg_org_member_role_insert',
    'trg_org_member_role_update', 'trg_org_last_owner_update', 'trg_org_last_owner_delete',
];
if ($driver === 'sqlite') {
    $triggers = array_map('strval', $pdo->query("SELECT name FROM sqlite_master WHERE type='trigger'")?->fetchAll(PDO::FETCH_COLUMN) ?: []);
} else {
    $triggers = array_map('strval', $pdo->query('SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE()')?->fetchAll(PDO::FETCH_COLUMN) ?: []);
}
$missingTriggers = array_values(array_diff($requiredTriggers, $triggers));
$record('schema.permission_invariants', $missingTriggers === [], $missingTriggers === [] ? 'active' : 'missing: ' . implode(', ', $missingTriggers));

$migrationFiles = array_map(static fn (string $file): string => pathinfo($file, PATHINFO_FILENAME), glob(dirname(__DIR__) . '/database/migrations/*.php') ?: []);
$applied = [];
try {
    $applied = array_map('strval', $pdo->query('SELECT migration FROM webman_migrations')?->fetchAll(PDO::FETCH_COLUMN) ?: []);
} catch (Throwable) {
}
$pending = array_values(array_diff($migrationFiles, $applied));
$record('schema.migrations', $pending === [], $pending === [] ? 'up-to-date' : 'pending: ' . implode(', ', $pending));

if ($driver === 'sqlite') {
    $integrity = (string) $pdo->query('PRAGMA quick_check')?->fetchColumn();
    $journal = strtolower((string) $pdo->query('PRAGMA journal_mode')?->fetchColumn());
    $foreignKeys = (int) $pdo->query('PRAGMA foreign_keys')?->fetchColumn();
    $busyTimeout = (int) $pdo->query('PRAGMA busy_timeout')?->fetchColumn();
    $record('sqlite.quick_check', $integrity === 'ok', $integrity);
    $record('sqlite.wal', $journal === 'wal', $journal);
    $record('sqlite.foreign_keys', $foreignKeys === 1, (string) $foreignKeys);
    $record('sqlite.busy_timeout', $busyTimeout >= 1000, $busyTimeout . ' ms');
    $workers = max(1, (int) (getenv('WEBMAN_WORKERS') ?: 1));
    $record('sqlite.worker_count', $workers <= 2, $workers . ' worker(s); 1 is recommended for the single-host profile', 'warning');
    $profile = (string) (getenv('WIKIST_DB_PROFILE') ?: '');
    $record('sqlite.profile', $profile === 'sqlite-single-host', $profile ?: 'not configured', 'warning');
}

foreach (['data', 'content/pages', 'content/revisions', 'public/uploads', 'logs', 'webman-backend/runtime', 'webman-backend/runtime/logs', 'webman-backend/runtime/sessions'] as $relative) {
    $path = $root . '/' . $relative;
    $exists = is_dir($path) && !is_link($path);
    $ownerId = $exists ? @fileowner($path) : false;
    $groupId = $exists ? @filegroup($path) : false;
    $owner = $ownerId !== false && function_exists('posix_getpwuid') ? ((posix_getpwuid($ownerId)['name'] ?? $ownerId)) : $ownerId;
    $group = $groupId !== false && function_exists('posix_getgrgid') ? ((posix_getgrgid($groupId)['name'] ?? $groupId)) : $groupId;
    $mode = $exists ? substr(sprintf('%o', fileperms($path)), -4) : 'missing';
    $record('filesystem.' . str_replace('/', '.', $relative), $exists && is_writable($path), $path . ' owner=' . $owner . ' group=' . $group . ' mode=' . $mode);
}
$free = @disk_free_space($root);
$record('filesystem.free_space', $free === false || $free >= 268435456, $free === false ? 'unknown' : round($free / 1048576, 1) . ' MiB');

$production = in_array(strtolower(getenv('APP_ENV') ?: 'development'), ['production', 'prod'], true);
$secret = (string) (getenv('APP_SECRET') ?: '');
$record('security.app_secret', !$production || strlen($secret) >= 32, $production ? 'production secret validation' : 'development');
$record('security.install_mode', getenv('WIKIST_INSTALL_MODE') !== '1', getenv('WIKIST_INSTALL_MODE') === '1' ? 'enabled' : 'disabled');
$siteConfigPath = $root . '/config/site.config.json';
$siteConfig = is_file($siteConfigPath) ? (json_decode((string) file_get_contents($siteConfigPath), true) ?: []) : [];
$configuredPublicUrl = (string) (getenv('WIKIST_PUBLIC_URL') ?: ($siteConfig['publicUrl'] ?? (getenv('APP_URL') ?: 'http://127.0.0.1:8899')));
$appUrl = $configuredPublicUrl;
$appParts = parse_url($appUrl) ?: [];
$canonicalPath = (string) ($appParts['path'] ?? '');
$canonicalLocal = in_array(strtolower((string) ($appParts['host'] ?? '')), ['localhost', '127.0.0.1', '::1'], true);
$canonicalValid = in_array((string) ($appParts['scheme'] ?? ''), ['http', 'https'], true) && !empty($appParts['host'])
    && in_array($canonicalPath, ['', '/'], true) && !isset($appParts['user']) && !isset($appParts['pass'])
    && !isset($appParts['query']) && !isset($appParts['fragment']);
$record('security.canonical_url', $canonicalValid && (!$production || (($appParts['scheme'] ?? '') === 'https' && !$canonicalLocal)), $appUrl);
$legacyAppUrl = (string) (getenv('APP_URL') ?: '');
$publicUrlConsistent = $legacyAppUrl === '' || rtrim($legacyAppUrl, '/') === rtrim($configuredPublicUrl, '/');
$record('security.public_url_consistency', $publicUrlConsistent, $publicUrlConsistent ? 'consistent' : 'APP_URL and canonical publicUrl differ', 'warning');
$origins = array_values(array_filter(array_map('trim', explode(',', (string) (getenv('TRUSTED_ORIGINS') ?: '')))));
$originsValid = $origins !== [];
foreach ($origins as $origin) {
    $parts = parse_url($origin) ?: [];
    $originsValid = $originsValid && !str_contains($origin, '*') && strpbrk($origin, "\r\n") === false
        && ($parts['scheme'] ?? '') === 'https' && !empty($parts['host'])
        && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['query']) && !isset($parts['fragment'])
        && (!isset($parts['path']) || in_array($parts['path'], ['', '/'], true));
}
$record('security.trusted_origins', !$production || $originsValid, $origins === [] ? 'not configured' : implode(', ', $origins));
$legacyProxy = filter_var(getenv('LEGACY_NODE_PROXY') ?: 'true', FILTER_VALIDATE_BOOL);
$legacyUrlValue = (string) (getenv('LEGACY_NODE_URL') ?: 'http://127.0.0.1:8900');
$legacyUrl = parse_url($legacyUrlValue) ?: [];
$legacyLoopback = in_array(strtolower((string) ($legacyUrl['host'] ?? '')), ['127.0.0.1', '::1', 'localhost'], true)
    && in_array(strtolower((string) ($legacyUrl['scheme'] ?? '')), ['http', 'https'], true)
    && !isset($legacyUrl['user']) && !isset($legacyUrl['pass']);
$record('security.legacy_loopback', !$legacyProxy || $legacyLoopback, $legacyUrlValue);
$record('deployment.legacy_internal_port', !$legacyProxy || (int) ($legacyUrl['port'] ?? 0) === 8900, $legacyProxy ? $legacyUrlValue : 'disabled', 'warning');
$record('security.legacy_internal_token', !$production || !$legacyProxy || strlen((string) getenv('LEGACY_NODE_TOKEN')) >= 32, $legacyProxy ? 'compatibility enabled' : 'disabled');
$centrifugo = filter_var(getenv('CENTRIFUGO_ENABLED') ?: 'false', FILTER_VALIDATE_BOOL);
$realtimeSecrets = strlen((string) getenv('CENTRIFUGO_TOKEN_HMAC_SECRET')) >= 32 && strlen((string) getenv('CENTRIFUGO_API_KEY')) >= 32;
$record('security.realtime_secrets', !$centrifugo || $realtimeSecrets, $centrifugo ? 'dedicated secrets required' : 'disabled');
$centrifugoApiValue = (string) (getenv('CENTRIFUGO_API_URL') ?: 'http://127.0.0.1:8902/api');
$centrifugoApi = parse_url($centrifugoApiValue) ?: [];
$centrifugoApiInternal = in_array(strtolower((string) ($centrifugoApi['host'] ?? '')), ['127.0.0.1', '::1', 'localhost'], true) && (int) ($centrifugoApi['port'] ?? 0) === 8902;
$record('security.realtime_api_internal', !$centrifugo || $centrifugoApiInternal, $centrifugo ? $centrifugoApiValue : 'disabled');
$realtimePublicValue = (string) (getenv('CENTRIFUGO_PUBLIC_URL') ?: '');
$realtimePublic = parse_url($realtimePublicValue) ?: [];
$realtimePublicValid = !$centrifugo || (in_array((string) ($realtimePublic['scheme'] ?? ''), ['ws', 'wss'], true) && !empty($realtimePublic['host'])
    && (!$production || (($realtimePublic['scheme'] ?? '') === 'wss' && !in_array(strtolower((string) ($realtimePublic['host'] ?? '')), ['localhost', '127.0.0.1', '::1'], true))));
$record('security.realtime_public_url', $realtimePublicValid, $centrifugo ? ($realtimePublicValue ?: 'not configured') : 'disabled');
$record('security.backup_signing', !filter_var(getenv('WIKIST_REQUIRE_SIGNED_BACKUPS') ?: 'false', FILTER_VALIDATE_BOOL) || strlen((string) getenv('WIKIST_BACKUP_SIGNING_KEY')) >= 32, 'optional HMAC-SHA256');
$record('security.release_signing', !filter_var(getenv('WIKIST_REQUIRE_SIGNED_RELEASE') ?: 'false', FILTER_VALIDATE_BOOL) || strlen((string) getenv('WIKIST_RELEASE_SIGNING_KEY')) >= 32, 'optional HMAC-SHA256');

if (is_file($siteConfigPath)) {
    if (PHP_OS_FAMILY !== 'Windows') {
        $mode = fileperms($siteConfigPath) & 0777;
        $record('filesystem.site_config_permissions', ($mode & 0077) === 0, decoct($mode));
    }
    $sitePublicUrl = (string) ($siteConfig['publicUrl'] ?? '');
    $record('deployment.site_public_url', $sitePublicUrl !== '', $sitePublicUrl ?: 'not configured');
    $publicUrlOverrideConsistent = getenv('WIKIST_PUBLIC_URL') === false || rtrim((string) getenv('WIKIST_PUBLIC_URL'), '/') === rtrim($sitePublicUrl, '/');
    $record('deployment.public_url_override', $publicUrlOverrideConsistent, $publicUrlOverrideConsistent ? 'consistent' : 'environment override differs from site configuration', 'warning');
    $knownCdn = [
        'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js',
        'https://cdn.jsdelivr.net/npm/function-plot@1.25.4/dist/function-plot.js',
        'https://cdn.jsdelivr.net/npm/mathjs@14.0.1/lib/browser/math.js',
        'https://cdn.jsdelivr.net/npm/jsxgraph@1.10.1/distrib/jsxgraphcore.js',
        'https://cdn.jsdelivr.net/npm/jsxgraph@1.10.1/distrib/jsxgraph.css',
        'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
        'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js',
    ];
    $externalCdn = [];
    $scanCdn = static function (mixed $value, string $key = '') use (&$scanCdn, &$externalCdn, $appParts): void {
        if (is_array($value)) {
            foreach ($value as $name => $item) $scanCdn($item, (string) $name);
            return;
        }
        if (!is_string($value) || $value === '' || !preg_match('/cdn/i', $key)) return;
        $parts = parse_url($value) ?: [];
        if (($parts['scheme'] ?? '') === 'https' && !empty($parts['host']) && strcasecmp((string) $parts['host'], (string) ($appParts['host'] ?? '')) !== 0) {
            $externalCdn[] = $value;
        }
    };
    $scanCdn($siteConfig);
    $unverifiedCdn = array_values(array_diff(array_unique($externalCdn), $knownCdn));
    $allowUnverifiedCdn = filter_var(getenv('WIKIST_ALLOW_UNVERIFIED_CDN') ?: 'false', FILTER_VALIDATE_BOOL);
    $record('security.cdn_integrity', !$production || $unverifiedCdn === [] || $allowUnverifiedCdn, $unverifiedCdn === [] ? 'pinned SRI assets only' : 'review: ' . implode(', ', $unverifiedCdn));
}

$requiredExtensions = ['pdo', 'mbstring', 'openssl', 'json', 'curl', 'gd', 'intl', 'xml', 'zip'];
if ($driver === 'sqlite') array_push($requiredExtensions, 'pdo_sqlite', 'sqlite3');
if ($production) $requiredExtensions[] = 'Zend OPcache';
foreach ($requiredExtensions as $extension) {
    $record('runtime.php_extension.' . strtolower(str_replace(' ', '_', $extension)), extension_loaded($extension), extension_loaded($extension) ? 'loaded' : 'missing');
}

$webmanPort = (int) (getenv('WEBMAN_PORT') ?: 8899);
$record('deployment.webman_port', $webmanPort === 8899, (string) $webmanPort, 'warning');
$stackPath = $root . '/data/wikist-stack.json';
if (is_file($stackPath)) {
    $stack = json_decode((string) file_get_contents($stackPath), true) ?: [];
    $hasPublicUrl = isset($stack['publicUrl']) || isset($stack['centrifugo']['publicUrl']);
    $record('deployment.stack_internal_only', !$hasPublicUrl, $hasPublicUrl ? 'remove browser-facing publicUrl from data/wikist-stack.json' : 'internal topology only');
    $stackPort = (int) ($stack['centrifugo']['port'] ?? 8902);
    $record('deployment.centrifugo_port', $stackPort === 8902, (string) $stackPort, 'warning');
}

if (PHP_OS_FAMILY !== 'Windows') {
    $systemEnvPath = getenv('WIKIST_SYSTEM_ENV') ?: '/etc/wikist/wikist.env';
    if (is_file($systemEnvPath) && is_readable($systemEnvPath)) {
        $systemEnv = (string) file_get_contents($systemEnvPath);
        $readEnvValue = static function (string $name) use ($systemEnv): string {
            return preg_match('/^' . preg_quote($name, '/') . '=(.*)$/m', $systemEnv, $match)
                ? trim($match[1], " \t\r\n\"'") : '';
        };
        $systemPublicUrl = $readEnvValue('WIKIST_PUBLIC_URL') ?: $readEnvValue('APP_URL');
        $systemRealtime = $readEnvValue('CENTRIFUGO_PUBLIC_URL');
        $expectedRealtime = preg_replace('/^http/i', 'ws', rtrim($configuredPublicUrl, '/')) . '/connection/websocket';
        $record('deployment.system_env_public_url', rtrim($systemPublicUrl, '/') === rtrim($configuredPublicUrl, '/'), "expected={$configuredPublicUrl}; actual=" . ($systemPublicUrl ?: 'missing'));
        $record('deployment.system_env_realtime_url', !$centrifugo || rtrim($systemRealtime, '/') === rtrim($expectedRealtime, '/'), "expected={$expectedRealtime}; actual=" . ($systemRealtime ?: 'missing'));
        $mode = fileperms($systemEnvPath) & 0777;
        $record('filesystem.system_env_permissions', ($mode & 0007) === 0, decoct($mode));
    } else {
        $record('deployment.system_env', true, 'not installed or not readable');
    }
    $servicePath = '/etc/systemd/system/wikist.service';
    if (is_file($servicePath) && is_readable($servicePath)) {
        $service = (string) file_get_contents($servicePath);
        $serviceValid = str_contains($service, 'tools/start-hybrid.js')
            && !preg_match('/ExecStart=.*(?:^|\s)server\.js(?:\s|$)/m', $service)
            && str_contains($service, 'EnvironmentFile=/etc/wikist/wikist.env');
        $record('deployment.systemd_hybrid', $serviceValid, $serviceValid ? 'hybrid launcher active' : 'expected tools/start-hybrid.js with /etc/wikist/wikist.env');
    }
}

if ($scope !== 'all') {
    $prefixes = $scope === 'urls'
        ? ['security.canonical_url', 'security.public_url_consistency', 'security.trusted_origins', 'security.legacy_loopback', 'security.realtime_', 'deployment.']
        : ['database.', 'schema.', 'sqlite.'];
    $checks = array_values(array_filter($checks, static function (array $check) use ($prefixes): bool {
        foreach ($prefixes as $prefix) if (str_starts_with($check['name'], $prefix)) return true;
        return false;
    }));
}

$failed = count(array_filter($checks, static fn (array $check): bool => !$check['ok'] && $check['severity'] === 'error'));
$warnings = count(array_filter($checks, static fn (array $check): bool => !$check['ok'] && $check['severity'] === 'warning'));
echo json_encode(['ok' => $failed === 0, 'checkedAt' => gmdate('c'), 'scope' => $scope, 'driver' => $driver, 'failed' => $failed, 'warnings' => $warnings, 'checks' => $checks], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
exit($failed === 0 ? 0 : 1);

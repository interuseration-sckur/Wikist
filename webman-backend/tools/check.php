<?php

$root = dirname(__DIR__);
$errors = [];
$warnings = [];

if (PHP_VERSION_ID < 80100) {
    $errors[] = 'PHP 8.1 or newer is required.';
}
foreach (['pdo', 'mbstring', 'openssl', 'json', 'curl', 'gd'] as $extension) {
    if (!extension_loaded($extension)) {
        $errors[] = "Missing PHP extension: {$extension}";
    }
}
if (!extension_loaded('pdo_sqlite') && !extension_loaded('pdo_mysql')) {
    $errors[] = 'At least one of pdo_sqlite or pdo_mysql is required.';
}
foreach (['config/wikist.php', 'config/route.php', 'database/schema/wikist.sqlite.sql', 'database/schema/wikist.mysql.sql'] as $file) {
    if (!is_file("{$root}/{$file}")) {
        $errors[] = "Missing required file: {$file}";
    }
}
$projectRoot = dirname($root);
foreach (['public/passport/index.html', 'public/passport/passport.css', 'public/passport/passport.js', 'public/passport/assets/passport-cn.ttf', 'public/assets/design-system.css', 'public/assets/wikist-logo.png', 'public/assets/wikist-icon.png'] as $file) {
    if (!is_file("{$projectRoot}/{$file}")) {
        $errors[] = "Missing Passport frontend asset: {$file}";
    }
}

$autoload = "{$root}/vendor/autoload.php";
if (!is_file($autoload)) {
    $errors[] = 'Composer dependencies are missing.';
} else {
    require_once $autoload;
    try {
        $qr = (new \app\service\QrCodeService())->dataUri(
            'otpauth://totp/Wikist:check?secret=JBSWY3DPEHPK3PXP&issuer=Wikist&algorithm=SHA1&digits=6&period=30',
        );
        if (!str_starts_with($qr, 'data:image/png;base64,iVBORw')) {
            $errors[] = 'TOTP QR code generator returned an invalid PNG data URI.';
        }
    } catch (\Throwable $error) {
        $errors[] = 'TOTP QR code generator failed: ' . $error->getMessage();
    }
}

foreach ($warnings as $warning) {
    echo "WARN  {$warning}" . PHP_EOL;
}
foreach ($errors as $error) {
    echo "ERROR {$error}" . PHP_EOL;
}
if ($errors !== []) {
    exit(1);
}
echo 'OK    Wikist Webman foundation checks passed.' . PHP_EOL;

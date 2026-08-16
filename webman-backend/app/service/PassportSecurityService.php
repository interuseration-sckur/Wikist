<?php

namespace app\service;

use app\exception\ApiException;
use app\repository\PassportTokenRepository;
use app\repository\SiteConfigRepository;
use app\repository\UserRepository;

final class PassportSecurityService
{
    public function __construct(
        private readonly UserRepository $users = new UserRepository(),
        private readonly PassportTokenRepository $tokens = new PassportTokenRepository(),
        private readonly PasswordService $passwords = new PasswordService(),
        private readonly TotpService $totp = new TotpService(),
        private readonly SecretCipher $cipher = new SecretCipher(),
        private readonly QrCodeService $qrCodes = new QrCodeService(),
    ) {
    }

    public function status(int $userId): array
    {
        $row = $this->requiredUser($userId);
        $checks = [
            ['key' => 'email', 'ok' => (bool) ($row->email && $row->email_verified_at), 'label' => '邮箱已验证'],
            ['key' => 'password', 'ok' => (bool) $row->password_updated_at, 'label' => '密码已设置'],
            ['key' => 'twoFactor', 'ok' => (bool) $row->two_factor_enabled, 'label' => '二次验证'],
        ];
        return [
            'email' => (string) ($row->email ?? ''),
            'emailVerified' => (bool) ($row->email_verified_at ?? ''),
            'emailVerifiedAt' => (string) ($row->email_verified_at ?? ''),
            'twoFactorEnabled' => (bool) $row->two_factor_enabled,
            'twoFactorConfirmedAt' => (string) ($row->two_factor_confirmed_at ?? ''),
            'lastSecurityAt' => (string) ($row->last_security_at ?? ''),
            'securityScore' => (int) round(count(array_filter($checks, static fn ($item) => $item['ok'])) / count($checks) * 100),
            'checks' => $checks,
        ];
    }

    public function setupTwoFactor(int $userId, string $password, string $currentCode = ''): array
    {
        $row = $this->requiredUser($userId);
        if (!$this->passwords->verify($password, (string) $row->password_hash, (string) ($row->password_salt ?? ''))) {
            throw new ApiException('当前密码不正确。', 422, 'current_password_invalid');
        }
        if ($row->two_factor_enabled && !$this->totp->verify($this->cipher->decrypt((string) $row->two_factor_secret), $currentCode)) {
            throw new ApiException('当前二次验证码不正确。', 422, 'two_factor_invalid');
        }
        $secret = $this->totp->generateSecret();
        $this->users->updateTwoFactor($userId, [
            'pending_two_factor_secret' => $this->cipher->encrypt($secret),
            'pending_two_factor_created_at' => gmdate('c'),
        ]);
        $site = new SiteConfigRepository();
        $siteName = trim((string) $site->get('name', config('wikist.name'))) ?: 'Wikist';
        $issuer = rawurlencode((string) $site->get('passport.twoFactorIssuer', $siteName));
        $label = rawurlencode($siteName . ':' . $row->username);
        $otpauthUrl = "otpauth://totp/{$label}?secret={$secret}&issuer={$issuer}&algorithm=SHA1&digits=6&period=30";
        return [
            'secret' => $secret,
            'otpauthUrl' => $otpauthUrl,
            'qrCodeDataUri' => $this->qrCodes->dataUri($otpauthUrl),
        ];
    }

    public function enableTwoFactor(int $userId, string $code): array
    {
        $row = $this->requiredUser($userId);
        $secret = $this->cipher->decrypt((string) ($row->pending_two_factor_secret ?? ''));
        $createdAt = strtotime((string) ($row->pending_two_factor_created_at ?? '')) ?: 0;
        if ($secret === '' || $createdAt < time() - 600 || !$this->totp->verify($secret, $code)) {
            throw new ApiException('二次验证码不正确。', 422, 'two_factor_invalid');
        }
        $recoveryCodes = $this->recoveryCodes();
        $this->users->updateTwoFactor($userId, [
            'two_factor_secret' => (string) $row->pending_two_factor_secret,
            'two_factor_enabled' => 1,
            'two_factor_confirmed_at' => gmdate('c'),
            'two_factor_recovery_json' => json_encode(array_map(static fn (string $value): string => password_hash($value, PASSWORD_DEFAULT), $recoveryCodes)),
            'pending_two_factor_secret' => '',
            'pending_two_factor_created_at' => '',
        ], true);
        (new RealtimeSecurityService())->disconnectUser($userId, 'Two-factor authentication changed');
        return $this->status($userId) + ['recoveryCodes' => $recoveryCodes];
    }

    public function disableTwoFactor(int $userId, string $password, string $code): array
    {
        $row = $this->requiredUser($userId);
        if (!$this->passwords->verify($password, (string) $row->password_hash, (string) $row->password_salt)) {
            throw new ApiException('当前密码不正确。', 422, 'current_password_invalid');
        }
        if ($row->two_factor_enabled && !$this->totp->verify($this->cipher->decrypt((string) $row->two_factor_secret), $code)) {
            throw new ApiException('二次验证码不正确。', 422, 'two_factor_invalid');
        }
        $this->users->updateTwoFactor($userId, [
            'two_factor_enabled' => 0,
            'two_factor_secret' => '',
            'two_factor_confirmed_at' => '',
            'two_factor_recovery_json' => '[]',
            'pending_two_factor_secret' => '',
            'pending_two_factor_created_at' => '',
        ], true);
        (new RealtimeSecurityService())->disconnectUser($userId, 'Two-factor authentication changed');
        return $this->status($userId);
    }

    public function createEmailTicket(int $userId): array
    {
        $row = $this->requiredUser($userId);
        if (!$row->email) {
            throw new ApiException('请先绑定邮箱。', 422, 'email_missing');
        }
        $ttl = (int) (new SiteConfigRepository())->get('passport.emailVerificationTTLSeconds', 1800);
        return $this->tokens->create($userId, 'email_verify', (string) $row->email, $ttl) + ['user' => $this->users->identity($row)];
    }

    public function verifyEmail(string $token): array
    {
        $ticket = $this->tokens->consumeAny($token, ['email_verify', 'email_change']);
        if ((string) $ticket->purpose === 'email_change') {
            $user = $this->users->confirmPendingEmail((int) $ticket->user_id, (string) $ticket->email)->toArray();
            (new RealtimeSecurityService())->disconnectUser((int) $ticket->user_id, 'Email address changed');
            return $user;
        }
        return $this->users->markEmailVerified((int) $ticket->user_id, (string) $ticket->email)->toArray();
    }

    public function requestEmailChange(int $userId, string $email, string $password, string $twoFactorCode = ''): array
    {
        $row = $this->requiredUser($userId);
        $email = mb_strtolower(trim($email));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new ApiException('邮箱格式不正确。', 422, 'email_invalid');
        }
        if (!$this->passwords->verify($password, (string) $row->password_hash, (string) ($row->password_salt ?? ''))) {
            throw new ApiException('当前密码不正确。', 422, 'current_password_invalid');
        }
        if ($row->two_factor_enabled && !$this->totp->verify($this->cipher->decrypt((string) $row->two_factor_secret), $twoFactorCode)) {
            throw new ApiException('当前二次验证码不正确。', 422, 'two_factor_invalid');
        }
        if ($this->users->emailExists($email)) {
            throw new ApiException('该邮箱已被使用。', 409, 'email_exists');
        }
        $this->users->setPendingEmail($userId, $email);
        $ttl = (int) (new SiteConfigRepository())->get('passport.emailVerificationTTLSeconds', 1800);
        return $this->tokens->create($userId, 'email_change', $email, $ttl) + ['email' => $email];
    }

    public function createPasswordReset(string $identifier): ?array
    {
        $row = $this->users->findByIdentifier($identifier);
        if (!$row || !in_array($row->status, ['active', 'ok'], true) || !$row->email || !$row->email_verified_at) {
            return null;
        }
        $ttl = (int) (new SiteConfigRepository())->get('passport.passwordResetTTLSeconds', 1200);
        return $this->tokens->create((int) $row->id, 'password_reset', (string) $row->email, $ttl) + ['user' => $this->users->identity($row)];
    }

    public function resetPassword(string $token, string $newPassword): void
    {
        $this->assertPassword($newPassword);
        $ticket = $this->tokens->consume($token, 'password_reset');
        $this->users->replacePassword((int) $ticket->user_id, $this->passwords->hash($newPassword));
        $this->users->deleteSessions((int) $ticket->user_id);
        $this->tokens->invalidate((int) $ticket->user_id, 'password_reset');
        (new RealtimeSecurityService())->disconnectUser((int) $ticket->user_id, 'Password reset');
    }

    public function changePassword(int $userId, string $current, string $next): void
    {
        $row = $this->requiredUser($userId);
        if (!$this->passwords->verify($current, (string) $row->password_hash, (string) $row->password_salt)) {
            throw new ApiException('当前密码不正确。', 422, 'current_password_invalid');
        }
        if ($current === $next) {
            throw new ApiException('新密码不能与当前密码相同。', 422, 'password_unchanged');
        }
        $this->assertPassword($next);
        $this->users->replacePassword($userId, $this->passwords->hash($next));
        $this->users->deleteSessions($userId);
        (new RealtimeSecurityService())->disconnectUser($userId, 'Password changed');
    }

    public function verifyLoginTwoFactor(object $row, string $code): void
    {
        if (!$row->two_factor_enabled) {
            return;
        }
        if ($this->totp->verify($this->cipher->decrypt((string) $row->two_factor_secret), $code)) {
            return;
        }
        $normalized = strtoupper(trim($code));
        $hashes = json_decode((string) ($row->two_factor_recovery_json ?? '[]'), true);
        if (!is_array($hashes)) {
            $hashes = [];
        }
        foreach ($hashes as $index => $hash) {
            if (!is_string($hash) || !password_verify($normalized, $hash)) {
                continue;
            }
            unset($hashes[$index]);
            $this->users->updateTwoFactor((int) $row->id, [
                'two_factor_recovery_json' => json_encode(array_values($hashes), JSON_UNESCAPED_SLASHES),
            ], true);
            (new RealtimeSecurityService())->disconnectUser((int) $row->id, 'Recovery code used');
            return;
        }
        throw new ApiException('二次验证码不正确。', 401, 'two_factor_required');
    }

    private function requiredUser(int $userId): object
    {
        return $this->users->findRawById($userId) ?? throw new ApiException('账号不存在。', 404, 'user_not_found');
    }

    private function assertPassword(string $password): void
    {
        if (strlen($password) < 8 || strlen($password) > 128) {
            throw new ApiException('密码需为 8-128 位。', 422, 'password_invalid');
        }
    }

    private function recoveryCodes(): array
    {
        $codes = [];
        for ($index = 0; $index < 10; $index += 1) {
            $raw = strtoupper(bin2hex(random_bytes(5)));
            $codes[] = substr($raw, 0, 5) . '-' . substr($raw, 5);
        }
        return $codes;
    }
}

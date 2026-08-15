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

    public function setupTwoFactor(int $userId): array
    {
        $row = $this->requiredUser($userId);
        $secret = $this->totp->generateSecret();
        $this->users->updateTwoFactor($userId, [
            'two_factor_secret' => $this->cipher->encrypt($secret),
            'two_factor_enabled' => 0,
            'two_factor_confirmed_at' => '',
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
        $secret = $this->cipher->decrypt((string) $row->two_factor_secret);
        if ($secret === '' || !$this->totp->verify($secret, $code)) {
            throw new ApiException('二次验证码不正确。', 422, 'two_factor_invalid');
        }
        $this->users->updateTwoFactor($userId, ['two_factor_enabled' => 1, 'two_factor_confirmed_at' => gmdate('c')]);
        return $this->status($userId);
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
        $this->users->updateTwoFactor($userId, ['two_factor_enabled' => 0, 'two_factor_secret' => '', 'two_factor_confirmed_at' => '']);
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
        $ticket = $this->tokens->consume($token, 'email_verify');
        return $this->users->markEmailVerified((int) $ticket->user_id, (string) $ticket->email)->toArray();
    }

    public function createPasswordReset(string $identifier): ?array
    {
        $row = $this->users->findByIdentifier($identifier);
        if (!$row || !in_array($row->status, ['active', 'ok'], true) || !$row->email) {
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
    }

    public function verifyLoginTwoFactor(object $row, string $code): void
    {
        if (!$row->two_factor_enabled) {
            return;
        }
        if (!$this->totp->verify($this->cipher->decrypt((string) $row->two_factor_secret), $code)) {
            throw new ApiException('二次验证码不正确。', 401, 'two_factor_required');
        }
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
}

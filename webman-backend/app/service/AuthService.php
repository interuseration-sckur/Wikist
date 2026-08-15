<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\CompatibilitySessionRepository;
use app\repository\UserRepository;
use support\Request;

final class AuthService
{
    public function __construct(
        private readonly UserRepository $users = new UserRepository(),
        private readonly CompatibilitySessionRepository $compatibilitySessions = new CompatibilitySessionRepository(),
        private readonly PasswordService $passwords = new PasswordService(),
    ) {
    }

    public function current(Request $request): ?UserIdentity
    {
        if ($request->identity instanceof UserIdentity) {
            return $request->identity;
        }
        $sessionCookie = $request->cookie(config('session.session_name', 'wikist_session'));
        $legacyCookieName = config('wikist.legacy_bridge.cookie', 'wikist_passport');
        $legacyToken = (string) $request->cookie($legacyCookieName, '');
        if (!$sessionCookie && $legacyToken === '') {
            return null;
        }

        if ($sessionCookie) {
            $userId = (int) $request->session()->get('passport.user_id', 0);
            if ($userId > 0) {
                $identity = $this->users->findById($userId);
                if ($identity?->isActive()) {
                    return $request->identity = $identity;
                }
                $request->session()->forget(['passport.user_id', 'passport.authenticated_at']);
            }
        }

        if (config('wikist.legacy_bridge.enabled', true) && $legacyToken !== '') {
            $identity = $this->compatibilitySessions->resolve($legacyToken);
            if ($identity?->isActive()) {
                $request->sessionRegenerateId(true);
                $request->session()->put([
                    'passport.user_id' => $identity->id,
                    'passport.authenticated_at' => time(),
                ]);
                return $request->identity = $identity;
            }
        }
        return null;
    }

    /** @return array{user:UserIdentity,legacyToken:string,legacyExpiresAt:string} */
    public function login(Request $request, array $input): array
    {
        (new LoginRateLimiter())->hit($request->getRealIp());
        (new CaptchaService())->verifyInput($request, $input);
        $identifier = trim((string) ($input['identifier'] ?? $input['user'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        $row = $this->users->findByIdentifier($identifier);
        if (!$row || !$this->passwords->verify($password, (string) $row->password_hash, (string) ($row->password_salt ?? ''))) {
            throw new ApiException('账号或密码不正确。', 401, 'invalid_credentials');
        }
        $identity = $this->users->identity($row);
        if (!$identity?->isActive()) {
            throw new ApiException('该账号已被封禁，无法登录。', 403, 'account_disabled');
        }
        $site = new \app\repository\SiteConfigRepository();
        if ($site->get('passport.requireEmailVerification', false) && $row->email && !$row->email_verified_at) {
            throw new ApiException('请先完成邮箱验证后再登录。', 403, 'email_verification_required');
        }
        (new PassportSecurityService())->verifyLoginTwoFactor($row, (string) ($input['twoFactorCode'] ?? ''));
        if (config('wikist.passport.rehash_on_login', false) && $this->passwords->needsRehash((string) $row->password_hash)) {
            $this->users->replacePassword($identity->id, $this->passwords->hash($password));
        }

        $request->sessionRegenerateId(true);
        $request->session()->put([
            'passport.user_id' => $identity->id,
            'passport.authenticated_at' => time(),
        ]);
        $legacy = $this->compatibilitySessions->create($identity->id, $request->getRealIp(), (string) $request->header('user-agent'));
        $request->identity = $identity;
        return ['user' => $identity, 'legacyToken' => $legacy['token'], 'legacyExpiresAt' => $legacy['expiresAt']];
    }

    /** @return array{user:UserIdentity,legacyToken:string,legacyExpiresAt:string,initialAdmin:bool} */
    public function register(Request $request, array $input): array
    {
        (new LoginRateLimiter())->hit($request->getRealIp());
        (new CaptchaService())->verifyInput($request, $input);
        $username = trim((string) ($input['username'] ?? ''));
        $displayName = trim((string) ($input['displayName'] ?? ''));
        $email = mb_strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $confirm = (string) ($input['confirmPassword'] ?? $input['confirm-password'] ?? '');

        if (!preg_match('/^[A-Za-z0-9_-]{3,32}$/', $username)) {
            throw new ApiException('用户名需为 3-32 位字母、数字、下划线或连字符。', 422, 'username_invalid');
        }
        if ($displayName === '' || mb_strlen($displayName) > 80) {
            throw new ApiException('显示名称不能为空且不能超过 80 个字符。', 422, 'display_name_invalid');
        }
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new ApiException('邮箱格式不正确。', 422, 'email_invalid');
        }
        if (strlen($password) < 8 || strlen($password) > 128 || $password !== $confirm) {
            throw new ApiException('密码需为 8-128 位，且两次输入必须一致。', 422, 'password_invalid');
        }
        if ($this->users->usernameExists($username) || $this->users->emailExists($email)) {
            throw new ApiException('用户名或邮箱已被使用。', 409, 'identity_exists');
        }

        $identity = $this->users->create(compact('username', 'displayName', 'email'), $this->passwords->hash($password), '');
        $initialAdmin = $identity->role === 'admin';
        $request->sessionRegenerateId(true);
        $request->session()->put(['passport.user_id' => $identity->id, 'passport.authenticated_at' => time()]);
        $legacy = $this->compatibilitySessions->create($identity->id, $request->getRealIp(), (string) $request->header('user-agent'));
        $request->identity = $identity;
        return ['user' => $identity, 'legacyToken' => $legacy['token'], 'legacyExpiresAt' => $legacy['expiresAt'], 'initialAdmin' => $initialAdmin];
    }

    public function logout(Request $request): void
    {
        $this->compatibilitySessions->delete((string) $request->cookie(config('wikist.legacy_bridge.cookie'), ''));
        $request->session()->flush();
        $request->identity = null;
    }
}

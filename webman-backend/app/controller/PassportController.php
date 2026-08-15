<?php

namespace app\controller;

use app\exception\ApiException;
use app\http\ApiResponse;
use app\service\AuthService;
use app\service\BehaviorCaptchaService;
use app\service\CaptchaService;
use app\service\CaptchaRateLimiter;
use app\service\MailService;
use app\service\PassportSecurityService;
use app\service\CentrifugoTokenService;
use app\service\MessagingPermissionService;
use app\service\AchievementService;
use app\service\MessagingService;
use app\repository\UserRepository;
use support\Request;
use support\Response;

final class PassportController
{
    public function captcha(Request $request): Response
    {
        return ApiResponse::data((new CaptchaService())->create($request));
    }

    public function behaviorCaptcha(Request $request): Response
    {
        (new CaptchaRateLimiter())->hit($request->getRealIp());
        return ApiResponse::data((new BehaviorCaptchaService())->create($request), 200, [
            'Cache-Control' => 'no-store, private',
            'Pragma' => 'no-cache',
        ]);
    }

    public function checkBehaviorCaptcha(Request $request): Response
    {
        (new CaptchaRateLimiter())->hit($request->getRealIp());
        return ApiResponse::data((new BehaviorCaptchaService())->check($request, $this->input($request)));
    }

    public function availability(Request $request): Response
    {
        $username = trim((string) $request->get('username', ''));
        $email = mb_strtolower(trim((string) $request->get('email', '')));
        $users = new UserRepository();
        return ApiResponse::data([
            'usernameAvailable' => $username === '' ? null : !$users->usernameExists($username),
            'emailAvailable' => $email === '' ? null : !$users->emailExists($email),
        ]);
    }

    public function me(Request $request): Response
    {
        $user = $request->identity ? (new UserRepository())->profile($request->identity->id) : null;
        if ($request->identity) {
            try {
                foreach ((new AchievementService())->sync($request->identity->id) as $achievement) {
                    (new MessagingService())->notifyUser($request->identity, [
                        'title' => '获得新成就',
                        'bodyMd' => '你解锁了“' . $achievement['name'] . '”成就。',
                        'source' => 'achievement',
                        'eventType' => 'achievement.awarded',
                        'metadata' => ['achievement' => $achievement],
                    ]);
                }
            } catch (\Throwable) {
                // Account refresh must remain available while migrations are being applied.
            }
        }
        return ApiResponse::data(['user' => $user]);
    }

    public function login(Request $request): Response
    {
        $result = (new AuthService())->login($request, $this->input($request));
        $user = (new UserRepository())->profile($result['user']->id);
        return $this->withLegacyCookie(ApiResponse::data(['user' => $user]), $result['legacyToken']);
    }

    public function register(Request $request): Response
    {
        $result = (new AuthService())->register($request, $this->input($request));
        $verification = ['sent' => false, 'skipped' => $result['initialAdmin']];
        if (!$result['initialAdmin']) {
            try {
                $ticket = (new PassportSecurityService())->createEmailTicket($result['user']->id);
                $verification = (new MailService())->sendVerification($result['user'], $ticket['token']) + ['expiresAt' => $ticket['expiresAt'], 'sent' => true];
            } catch (\Throwable $error) {
                $verification = ['sent' => false, 'error' => $error->getMessage()];
            }
        }
        $response = ApiResponse::data([
            'user' => (new UserRepository())->profile($result['user']->id),
            'verification' => $verification,
            'initialAdmin' => $result['initialAdmin'],
        ]);
        return $this->withLegacyCookie($response, $result['legacyToken']);
    }

    public function logout(Request $request): Response
    {
        (new AuthService())->logout($request);
        return ApiResponse::data(['ok' => true])->cookie(
            config('wikist.legacy_bridge.cookie', 'wikist_passport'),
            '',
            0,
            '/',
            (string) config('session.domain', ''),
            (bool) config('session.secure', true),
            true,
            'Lax',
        );
    }

    public function realtimeTicket(Request $request): Response
    {
        (new MessagingPermissionService())->synchronize($request->identity);
        $credential = (new CentrifugoTokenService())->connectionToken($request->identity);
        return ApiResponse::data($credential + [
            'ticket' => $credential['token'],
            'url' => config('wikist.centrifugo.public_url'),
            'enabled' => (bool) config('wikist.centrifugo.enabled', false),
            'transport' => 'centrifugo',
        ]);
    }

    public function updateProfile(Request $request): Response
    {
        try {
            $identity = (new UserRepository())->updateProfile($request->identity->id, $this->input($request));
        } catch (\InvalidArgumentException $error) {
            throw new ApiException($error->getMessage(), 422, 'profile_invalid');
        }
        $request->identity = $identity;
        return ApiResponse::data(['user' => (new UserRepository())->profile($identity->id)]);
    }

    public function sendEmailVerification(Request $request): Response
    {
        $ticket = (new PassportSecurityService())->createEmailTicket($request->identity->id);
        $mail = (new MailService())->sendVerification($ticket['user'], $ticket['token']);
        return ApiResponse::data(['ok' => true, 'mail' => $mail, 'expiresAt' => $ticket['expiresAt']]);
    }

    public function verifyEmail(Request $request): Response
    {
        $user = (new PassportSecurityService())->verifyEmail((string) ($this->input($request)['token'] ?? ''));
        return ApiResponse::data(['ok' => true, 'user' => $user]);
    }

    public function forgotPassword(Request $request): Response
    {
        $input = $this->input($request);
        (new CaptchaService())->verifyInput($request, $input);
        $ticket = (new PassportSecurityService())->createPasswordReset((string) ($input['identifier'] ?? $input['email'] ?? ''));
        if ($ticket) {
            (new MailService())->sendPasswordReset($ticket['user'], $ticket['token']);
        }
        return ApiResponse::data(['ok' => true]);
    }

    public function resetPassword(Request $request): Response
    {
        $input = $this->input($request);
        (new PassportSecurityService())->resetPassword((string) ($input['token'] ?? ''), (string) ($input['newPassword'] ?? ''));
        return ApiResponse::data(['ok' => true]);
    }

    public function changePassword(Request $request): Response
    {
        $input = $this->input($request);
        (new PassportSecurityService())->changePassword(
            $request->identity->id,
            (string) ($input['currentPassword'] ?? ''),
            (string) ($input['newPassword'] ?? ''),
        );
        $request->session()->flush();
        return ApiResponse::data(['ok' => true])->cookie(
            config('wikist.legacy_bridge.cookie', 'wikist_passport'), '', 0, '/',
            (string) config('session.domain', ''), (bool) config('session.secure', true), true, 'Lax',
        );
    }

    public function security(Request $request): Response
    {
        return ApiResponse::data(['security' => (new PassportSecurityService())->status($request->identity->id)]);
    }

    public function setupTwoFactor(Request $request): Response
    {
        return ApiResponse::data((new PassportSecurityService())->setupTwoFactor($request->identity->id), 200, [
            'Cache-Control' => 'no-store, private',
            'Pragma' => 'no-cache',
        ]);
    }

    public function enableTwoFactor(Request $request): Response
    {
        $security = (new PassportSecurityService())->enableTwoFactor(
            $request->identity->id,
            (string) ($this->input($request)['code'] ?? ''),
        );
        return ApiResponse::data(['security' => $security]);
    }

    public function disableTwoFactor(Request $request): Response
    {
        $input = $this->input($request);
        $security = (new PassportSecurityService())->disableTwoFactor(
            $request->identity->id,
            (string) ($input['currentPassword'] ?? ''),
            (string) ($input['code'] ?? ''),
        );
        return ApiResponse::data(['security' => $security]);
    }

    private function input(Request $request): array
    {
        $post = $request->post();
        if ($post !== []) {
            return $post;
        }
        $decoded = json_decode($request->rawBody(), true);
        return is_array($decoded) ? $decoded : [];
    }

    private function withLegacyCookie(Response $response, string $token): Response
    {
        return $response->cookie(
            config('wikist.legacy_bridge.cookie', 'wikist_passport'),
            $token,
            (int) config('session.lifetime', 604800),
            '/',
            (string) config('session.domain', ''),
            (bool) config('session.secure', true),
            true,
            'Lax',
        );
    }
}

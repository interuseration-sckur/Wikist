<?php

namespace app\service;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\repository\SiteConfigRepository;
use PHPMailer\PHPMailer\PHPMailer;

final class MailService
{
    private SiteConfigRepository $site;

    public function __construct()
    {
        $this->site = new SiteConfigRepository();
    }

    public function sendVerification(UserIdentity $user, string $token): array
    {
        $url = $this->baseUrl() . '/passport?mode=verify&token=' . rawurlencode($token);
        $siteName = $this->siteName();
        return $this->send(
            $user->email,
            $siteName . ' 邮箱验证',
            '验证你的 ' . $siteName . ' 邮箱',
            '完成验证后，你可以安全地找回密码并保护贡献身份。',
            $url,
        );
    }

    public function sendPasswordReset(UserIdentity $user, string $token): array
    {
        $url = $this->baseUrl() . '/passport?mode=reset&token=' . rawurlencode($token);
        $siteName = $this->siteName();
        return $this->send(
            $user->email,
            $siteName . ' 找回密码',
            '重置 ' . $siteName . ' 密码',
            '链接仅在短时间内有效；成功重置后，旧会话会全部失效。',
            $url,
        );
    }

    private function send(string $to, string $subject, string $title, string $message, string $url): array
    {
        if (!$this->site->get('mail.enabled', false)) {
            throw new ApiException('邮件系统尚未启用。', 503, 'mail_disabled');
        }
        $host = (string) $this->site->get('mail.smtp.host', '');
        $from = (string) $this->site->get('mail.fromAddress', $this->site->get('mail.smtp.user', ''));
        if ($host === '' || $from === '') {
            throw new ApiException('SMTP 配置不完整。', 503, 'mail_not_configured');
        }
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = $host;
        $mail->Port = (int) $this->site->get('mail.smtp.port', 587);
        $user = (string) $this->site->get('mail.smtp.user', '');
        $pass = (string) $this->site->get('mail.smtp.pass', '');
        $mail->SMTPAuth = $user !== '' || $pass !== '';
        $mail->Username = $user;
        $mail->Password = $pass;
        if ($this->site->get('mail.smtp.secure', false)) {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        } elseif ($mail->Port === 587) {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        }
        $mail->CharSet = 'UTF-8';
        $mail->setFrom($from, (string) $this->site->get('mail.fromName', config('wikist.name')));
        $mail->addAddress($to);
        $mail->Subject = $subject;
        $mail->isHTML(true);
        $safeTitle = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
        $safeMessage = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
        $safeUrl = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
        $mail->Body = "<div style=\"font-family:Segoe UI,Arial,sans-serif;line-height:1.7;color:#15211d\"><h2>{$safeTitle}</h2><p>{$safeMessage}</p><p><a href=\"{$safeUrl}\" style=\"display:inline-block;padding:10px 16px;border-radius:8px;background:#0f8a6c;color:#fff;text-decoration:none;font-weight:700\">打开验证链接</a></p><p style=\"color:#6b7b75;font-size:13px\">{$safeUrl}</p></div>";
        $mail->AltBody = $title . "\n\n" . $message . "\n" . $url;
        $mail->send();
        return ['ok' => true, 'messageId' => $mail->getLastMessageID()];
    }

    private function baseUrl(): string
    {
        return rtrim((string) $this->site->get('mail.baseUrl', config('wikist.url')), '/');
    }

    private function siteName(): string
    {
        $name = trim((string) $this->site->get('name', config('wikist.name')));
        return $name !== '' ? $name : 'Wikist';
    }
}

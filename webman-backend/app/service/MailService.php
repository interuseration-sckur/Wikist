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

    public function sendEmailChange(string $email, string $token): array
    {
        $url = $this->baseUrl() . '/passport?mode=verify&token=' . rawurlencode($token);
        $siteName = $this->siteName();
        return $this->send(
            $email,
            $siteName . ' 邮箱变更验证',
            '确认新的登录邮箱',
            '完成验证后，新邮箱才会替换当前邮箱，其他登录会话也会失效。',
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
        $port = (int) $this->site->get('mail.smtp.port', 587);
        $target = $this->resolveSmtpTarget($host, $port);
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = $target;
        $mail->Port = $port;
        $mail->SMTPOptions = ['ssl' => [
            'peer_name' => $host,
            'verify_peer' => true,
            'verify_peer_name' => true,
            'allow_self_signed' => false,
        ]];
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
        $value = rtrim(trim((string) $this->site->get('publicUrl', $this->site->get('mail.baseUrl', config('wikist.url')))), '/');
        $parts = parse_url($value);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            throw new ApiException('邮件公开地址配置无效。', 503, 'mail_base_url_invalid');
        }
        if (in_array(strtolower((string) config('wikist.environment', 'development')), ['production', 'prod'], true) && $scheme !== 'https') {
            throw new ApiException('生产环境邮件链接必须使用 HTTPS。', 503, 'mail_base_url_https_required');
        }
        return $value;
    }

    private function siteName(): string
    {
        $name = trim((string) $this->site->get('name', config('wikist.name')));
        return $name !== '' ? $name : 'Wikist';
    }

    private function resolveSmtpTarget(string $host, int $port): string
    {
        $host = trim($host, " \t\n\r\0\x0B[]");
        if ($host === '' || str_contains($host, '://') || preg_match('/[^A-Za-z0-9._:-]/', $host)) {
            throw new ApiException('SMTP 主机格式无效。', 422, 'smtp_host_invalid');
        }
        $allowedPorts = array_values(array_filter(array_map('intval', explode(',', getenv('SMTP_ALLOWED_PORTS') ?: '25,465,587,2525'))));
        if (!in_array($port, $allowedPorts, true)) {
            throw new ApiException('SMTP 端口未被服务器策略允许。', 422, 'smtp_port_not_allowed');
        }
        $addresses = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : [];
        if ($addresses === []) {
            foreach (dns_get_record($host, DNS_A | DNS_AAAA) ?: [] as $record) {
                $address = (string) ($record['ip'] ?? $record['ipv6'] ?? '');
                if ($address !== '') {
                    $addresses[] = $address;
                }
            }
        }
        $addresses = array_values(array_unique($addresses));
        if ($addresses === []) {
            throw new ApiException('SMTP 主机无法解析。', 422, 'smtp_host_unresolved');
        }
        $allowPrivate = filter_var(getenv('SMTP_ALLOW_PRIVATE_HOSTS') ?: 'false', FILTER_VALIDATE_BOOL);
        if (!$allowPrivate) {
            foreach ($addresses as $address) {
                $normalized = preg_match('/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i', $address, $matches)
                    ? $matches[1]
                    : $address;
                if (!filter_var($normalized, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                    throw new ApiException('SMTP 主机指向内网或保留地址，服务器策略已拒绝。', 422, 'smtp_private_host_denied');
                }
            }
        }
        return $addresses[0];
    }
}

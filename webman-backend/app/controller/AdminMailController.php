<?php

namespace app\controller;

use app\domain\passport\UserIdentity;
use app\exception\ApiException;
use app\http\ApiResponse;
use app\repository\AuditRepository;
use app\service\MailService;
use support\Request;
use support\Response;

final class AdminMailController
{
    public function test(Request $request): Response
    {
        if (!$request->identity instanceof UserIdentity) {
            throw new ApiException('需要管理员身份。', 401, 'admin_identity_missing');
        }
        $result = (new MailService())->sendTest($request->identity);
        (new AuditRepository())->record(
            $request,
            $request->identity,
            'mail.test',
            'mail',
            'smtp',
            '发送 SMTP 测试邮件',
            ['messageId' => $result['messageId'] ?? ''],
        );
        return ApiResponse::data(['sent' => true]);
    }
}

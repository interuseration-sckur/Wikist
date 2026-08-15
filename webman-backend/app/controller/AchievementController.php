<?php

namespace app\controller;

use app\http\ApiResponse;
use app\service\AchievementService;
use support\Request;
use support\Response;

final class AchievementController
{
    public function show(Request $request, string $userId): Response
    {
        return ApiResponse::data((new AchievementService())->publicSummary((int) $userId));
    }

    public function mine(Request $request): Response
    {
        return ApiResponse::data((new AchievementService())->overview(
            $request->identity->id,
            (int) $request->get('page', 1),
            (int) $request->get('limit', 12),
        ));
    }
}

<?php

namespace app\controller;

use app\exception\ApiException;
use app\http\ApiResponse;
use app\repository\AuditRepository;
use app\repository\UserRepository;
use app\service\RealtimeSecurityService;
use support\Request;
use support\Response;

final class AdminUserController
{
    public function index(Request $request): Response
    {
        $page = max(1, (int) $request->get('page', 1));
        $limit = max(1, min(100, (int) $request->get('limit', 20)));
        $search = trim((string) $request->get('q', ''));
        $users = new UserRepository();
        $total = $users->countForAdmin($search);
        $totalPages = max(1, (int) ceil($total / $limit));
        $page = min($page, $totalPages);
        $items = $users->listForAdmin($search, $limit, ($page - 1) * $limit);
        $pagination = [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'totalPages' => $totalPages,
            'hasPrevious' => $page > 1,
            'hasNext' => $page < $totalPages,
        ];
        return ApiResponse::data(['items' => $items, 'users' => $items, 'pagination' => $pagination]);
    }

    public function update(Request $request, int $id): Response
    {
        $input = $request->post();
        if ($input === []) {
            $decoded = json_decode($request->rawBody(), true);
            $input = is_array($decoded) ? $decoded : [];
        }
        try {
            $user = (new UserRepository())->updateByAdmin($id, $input);
        } catch (\InvalidArgumentException $error) {
            throw new ApiException($error->getMessage(), 422, 'user_update_invalid');
        }
        (new AuditRepository())->record(
            $request,
            $request->identity,
            'user.adminUpdate',
            'user',
            (string) $id,
            '后台编辑用户资料',
            ['role' => $user['role'], 'status' => $user['status']],
        );
        (new RealtimeSecurityService())->disconnectUser($id, 'Account updated by administrator');
        return ApiResponse::data(['user' => $user]);
    }
}

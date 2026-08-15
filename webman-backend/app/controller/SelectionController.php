<?php

namespace app\controller;

use app\http\ApiResponse;
use app\service\SelectionService;
use support\Request;
use support\Response;

final class SelectionController
{
    public function resolve(Request $request): Response
    {
        return ApiResponse::data((new SelectionService())->resolve(
            $request->identity,
            $this->input($request),
            (int) $request->get('page', 1),
        ));
    }

    public function show(Request $request, string $id): Response
    {
        return ApiResponse::data((new SelectionService())->detail($request->identity, (int) $id));
    }

    public function comments(Request $request, string $id): Response
    {
        return ApiResponse::data((new SelectionService())->comments(
            (int) $id,
            (int) $request->get('page', 1),
            (int) $request->get('limit', 20),
        ));
    }

    public function markers(Request $request): Response
    {
        return ApiResponse::data((new SelectionService())->markers(
            $request->identity,
            (string) $request->get('objectType', ''),
            (string) $request->get('objectId', ''),
        ));
    }

    public function addComment(Request $request, string $id): Response
    {
        return ApiResponse::data((new SelectionService())->addComment(
            $request->identity,
            (int) $id,
            $this->input($request),
        ), 201);
    }

    public function deleteComment(Request $request, string $id, string $commentId): Response
    {
        return ApiResponse::data((new SelectionService())->deleteComment(
            $request->identity,
            (int) $id,
            (int) $commentId,
        ));
    }

    public function like(Request $request, string $id): Response
    {
        return ApiResponse::data((new SelectionService())->setLike(
            $request->identity,
            (int) $id,
            $this->input($request),
        ));
    }

    public function activity(Request $request, string $id): Response
    {
        return ApiResponse::data((new SelectionService())->recordActivity(
            $request->identity,
            (int) $id,
            $this->input($request),
        ), 201);
    }

    public function delete(Request $request, string $id): Response
    {
        return ApiResponse::data((new SelectionService())->deleteSelection(
            $request->identity,
            (int) $id,
        ));
    }

    public function mine(Request $request): Response
    {
        return ApiResponse::data((new SelectionService())->mine(
            $request->identity,
            (string) $request->get('mode', 'all'),
            (int) $request->get('page', 1),
            (int) $request->get('limit', 12),
        ));
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
}

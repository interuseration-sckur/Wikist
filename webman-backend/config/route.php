<?php

use app\controller\HealthController;
use app\controller\AdminMailController;
use app\controller\AdminUserController;
use app\controller\FrontendController;
use app\controller\LegacyProxyController;
use app\controller\PassportController;
use app\controller\PassportPageController;
use app\controller\MessagingController;
use app\controller\SelectionController;
use app\controller\CommunityQaController;
use app\controller\AchievementController;
use app\controller\SseController;
use app\controller\SeoController;
use app\http\ApiResponse;
use app\middleware\RequireAuthMiddleware;
use app\middleware\RequireAdminMiddleware;
use support\Request;
use Webman\Route;

Route::disableDefaultRoute();

Route::get('/', [FrontendController::class, 'index']);
Route::get('/robots.txt', [SeoController::class, 'robots']);
Route::get('/sitemap.xml', [SeoController::class, 'sitemapIndex']);
Route::get('/sitemaps/{section:wiki|questions|discussions}-{page:\\d+}.xml', [SeoController::class, 'sitemap']);
Route::get('/wiki', [SeoController::class, 'wikiIndex']);
Route::get('/wiki/{slug:.+}', [SeoController::class, 'wiki']);
Route::get('/questions', [SeoController::class, 'questionIndex']);
Route::get('/questions/{id:[A-Za-z0-9_-]+}', [SeoController::class, 'question']);
Route::get('/discussions', [SeoController::class, 'discussionIndex']);
Route::get('/discussions/{organization:[A-Za-z0-9_-]+}/{id:\\d+}', [SeoController::class, 'discussion']);
Route::get('/passport', [PassportPageController::class, 'index']);
Route::get('/passport/', [PassportPageController::class, 'index']);
Route::get('/api/health', [HealthController::class, 'index']);
Route::get('/api/health/ready', [HealthController::class, 'ready']);
Route::get('/api/health/live', [HealthController::class, 'live']);

Route::group('/api/passport', static function (): void {
    Route::get('/captcha', [PassportController::class, 'captcha']);
    Route::get('/captcha/behavior', [PassportController::class, 'behaviorCaptcha']);
    Route::post('/captcha/behavior/check', [PassportController::class, 'checkBehaviorCaptcha']);
    Route::get('/availability', [PassportController::class, 'availability']);
    Route::get('/me', [PassportController::class, 'me']);
    Route::post('/login', [PassportController::class, 'login']);
    Route::post('/register', [PassportController::class, 'register']);
    Route::post('/logout', [PassportController::class, 'logout']);
    Route::post('/email/verification', [PassportController::class, 'sendEmailVerification'])
        ->middleware(RequireAuthMiddleware::class);
    Route::post('/email/change', [PassportController::class, 'changeEmail'])
        ->middleware(RequireAuthMiddleware::class);
    Route::post('/email/verify', [PassportController::class, 'verifyEmail']);
    Route::post('/password/forgot', [PassportController::class, 'forgotPassword']);
    Route::post('/password/reset', [PassportController::class, 'resetPassword']);
    Route::post('/password', [PassportController::class, 'changePassword'])
        ->middleware(RequireAuthMiddleware::class);
    Route::put('/profile', [PassportController::class, 'updateProfile'])
        ->middleware(RequireAuthMiddleware::class);
    Route::get('/security', [PassportController::class, 'security'])
        ->middleware(RequireAuthMiddleware::class);
    Route::post('/security/2fa/setup', [PassportController::class, 'setupTwoFactor'])
        ->middleware(RequireAuthMiddleware::class);
    Route::post('/security/2fa/enable', [PassportController::class, 'enableTwoFactor'])
        ->middleware(RequireAuthMiddleware::class);
    Route::post('/security/2fa/disable', [PassportController::class, 'disableTwoFactor'])
        ->middleware(RequireAuthMiddleware::class);
    Route::post('/realtime-ticket', [PassportController::class, 'realtimeTicket'])
        ->middleware(RequireAuthMiddleware::class);
    Route::get('/achievements', [AchievementController::class, 'mine'])
        ->middleware(RequireAuthMiddleware::class);
    // This membership API still lives in the compatibility service during the
    // staged migration, but remains an explicit authenticated Passport route.
    Route::get('/organizations', [LegacyProxyController::class, 'forward'])
        ->middleware(RequireAuthMiddleware::class);
});

Route::get('/api/realtime/events', [SseController::class, 'stream'])
    ->middleware(RequireAuthMiddleware::class);

Route::get('/api/achievements/users/{userId:\\d+}', [AchievementController::class, 'show']);

Route::post('/api/selections/resolve', [SelectionController::class, 'resolve']);
Route::get('/api/selections/markers', [SelectionController::class, 'markers']);
Route::get('/api/selections/{id:\\d+}', [SelectionController::class, 'show']);
Route::get('/api/selections/{id:\\d+}/comments', [SelectionController::class, 'comments']);
Route::group('/api/selections', static function (): void {
    Route::get('/mine', [SelectionController::class, 'mine']);
    Route::post('/{id:\\d+}/comments', [SelectionController::class, 'addComment']);
    Route::delete('/{id:\\d+}/comments/{commentId:\\d+}', [SelectionController::class, 'deleteComment']);
    Route::put('/{id:\\d+}/like', [SelectionController::class, 'like']);
    Route::post('/{id:\\d+}/activities', [SelectionController::class, 'activity']);
    Route::delete('/{id:\\d+}', [SelectionController::class, 'delete']);
})->middleware(RequireAuthMiddleware::class);

Route::get('/api/community/qa/bootstrap', [CommunityQaController::class, 'bootstrap']);
Route::get('/api/community/qa/search', [CommunityQaController::class, 'search']);
Route::get('/api/community/qa/questions', [CommunityQaController::class, 'index']);
Route::get('/api/community/qa/questions/{id}', [CommunityQaController::class, 'show']);
Route::get('/api/community/qa/objects/{type}/{id}/comments', [CommunityQaController::class, 'comments']);
Route::get('/api/community/qa/objects/{type}/{id}/revisions', [CommunityQaController::class, 'revisions']);
Route::get('/api/community/qa/objects/{type}/{id}/diff', [CommunityQaController::class, 'revisionDiff']);
Route::get('/api/community/qa/tags', [CommunityQaController::class, 'tags']);
Route::get('/api/community/qa/activity', [CommunityQaController::class, 'activity']);
Route::get('/api/community/qa/users/{userId}/reputation', [CommunityQaController::class, 'reputation']);
Route::get('/api/community/qa/users/{userId}/badges', [CommunityQaController::class, 'badges']);
Route::get('/api/community/qa/related', [CommunityQaController::class, 'related']);
Route::get('/api/community/qa/object-preview', [CommunityQaController::class, 'objectPreview']);
Route::get('/api/community/qa/attachments/{id}', [CommunityQaController::class, 'attachment']);
Route::group('/api/community/qa', static function (): void {
    Route::post('/questions', [CommunityQaController::class, 'create']);
    Route::put('/questions/{id}', [CommunityQaController::class, 'updateQuestion']);
    Route::delete('/questions/{id}', [CommunityQaController::class, 'deleteQuestion']);
    Route::post('/questions/{id}/close', [CommunityQaController::class, 'closeQuestion']);
    Route::post('/questions/{id}/reopen', [CommunityQaController::class, 'reopenQuestion']);
    Route::post('/questions/{id}/revisions', [CommunityQaController::class, 'proposeRevision']);
    Route::post('/questions/{id}/invitations', [CommunityQaController::class, 'inviteAnswer']);
    Route::put('/invitations/{id}', [CommunityQaController::class, 'respondAnswerInvite']);
    Route::post('/questions/{id}/answers', [CommunityQaController::class, 'answer']);
    Route::put('/answers/{id}', [CommunityQaController::class, 'updateAnswer']);
    Route::delete('/answers/{id}', [CommunityQaController::class, 'deleteAnswer']);
    Route::post('/questions/{questionId}/answers/{answerId}/accept', [CommunityQaController::class, 'acceptAnswer']);
    Route::post('/questions/{questionId}/answers/{answerId}/unaccept', [CommunityQaController::class, 'unacceptAnswer']);
    Route::post('/objects/{id}/comments', [CommunityQaController::class, 'comment']);
    Route::put('/comments/{id}', [CommunityQaController::class, 'updateComment']);
    Route::delete('/comments/{id}', [CommunityQaController::class, 'deleteComment']);
    Route::post('/objects/{type}/{id}/vote', [CommunityQaController::class, 'vote']);
    Route::post('/objects/{type}/{id}/reaction', [CommunityQaController::class, 'reaction']);
    Route::post('/objects/{type}/{id}/collection', [CommunityQaController::class, 'collection']);
    Route::post('/objects/{type}/{id}/follow', [CommunityQaController::class, 'follow']);
    Route::post('/objects/{type}/{id}/report', [CommunityQaController::class, 'report']);
    Route::get('/collections', [CommunityQaController::class, 'collections']);
    Route::get('/follows', [CommunityQaController::class, 'follows']);
    Route::get('/moderation/overview', [CommunityQaController::class, 'moderationOverview']);
    Route::get('/moderation/reports', [CommunityQaController::class, 'reports']);
    Route::put('/moderation/reports/{id}', [CommunityQaController::class, 'resolveReport']);
    Route::get('/moderation/reviews', [CommunityQaController::class, 'reviews']);
    Route::put('/moderation/reviews/{id}', [CommunityQaController::class, 'decideReview']);
    Route::post('/questions/{questionId}/answers/{answerId}/wiki-draft', [CommunityQaController::class, 'wikiDraft']);
    Route::post('/attachments', [CommunityQaController::class, 'uploadAttachment']);
})->middleware(RequireAuthMiddleware::class);

Route::group('/api/messaging', static function (): void {
    Route::get('/bootstrap', [MessagingController::class, 'bootstrap']);
    Route::get('/preferences', [MessagingController::class, 'preferences']);
    Route::put('/preferences', [MessagingController::class, 'updatePreferences']);
    Route::get('/inbox', [MessagingController::class, 'inbox']);
    Route::get('/conversations', [MessagingController::class, 'conversations']);
    Route::put('/read-all', [MessagingController::class, 'readAll']);
    Route::post('/conversations/direct', [MessagingController::class, 'direct']);
    Route::post('/conversations/organization', [MessagingController::class, 'organization']);
    Route::get('/conversations/{id}', [MessagingController::class, 'show']);
    Route::get('/conversations/{id}/messages', [MessagingController::class, 'messages']);
    Route::get('/conversations/{id}/members', [MessagingController::class, 'members']);
    Route::post('/conversations/{id}/messages', [MessagingController::class, 'send']);
    Route::put('/conversations/{id}/read', [MessagingController::class, 'read']);
    Route::put('/conversations/{id}/settings', [MessagingController::class, 'settings']);
    Route::put('/conversations/{id}/moderation', [MessagingController::class, 'moderation']);
    Route::put('/conversations/{id}/members/{userId:\\d+}/role', [MessagingController::class, 'memberRole']);
    Route::put('/conversations/{id}/members/{userId:\\d+}/mute', [MessagingController::class, 'memberMute']);
    Route::post('/conversations/{id}/typing', [MessagingController::class, 'typing']);
    Route::get('/conversations/{id}/presence', [MessagingController::class, 'presence']);
    Route::post('/presence/heartbeat', [MessagingController::class, 'heartbeat']);
    Route::post('/presence/offline', [MessagingController::class, 'offline']);
    Route::post('/conversations/{id}/subscription-token', [MessagingController::class, 'subscriptionToken']);
    Route::delete('/messages/{id}', [MessagingController::class, 'withdraw']);
    Route::delete('/messages/{id}/visibility', [MessagingController::class, 'hide']);
    Route::post('/attachments', [MessagingController::class, 'upload']);
    Route::get('/attachments/{id}', [MessagingController::class, 'attachment']);
    Route::get('/objects/suggest', [MessagingController::class, 'objectSuggestions']);
    Route::get('/users/suggest', [MessagingController::class, 'userSuggestions']);
    Route::post('/realtime/token', [MessagingController::class, 'connectionToken']);
})->middleware(RequireAuthMiddleware::class);

Route::group('/api/admin/users', static function (): void {
    Route::get('', [AdminUserController::class, 'index']);
    Route::put('/{id:\\d+}', [AdminUserController::class, 'update']);
})->middleware(RequireAdminMiddleware::class);

Route::post('/api/admin/mail/test', [AdminMailController::class, 'test'])
    ->middleware(RequireAdminMiddleware::class);

Route::fallback(static function (Request $request) {
    if (str_starts_with($request->path(), '/api/') || str_starts_with($request->path(), '/plugins/')) {
        return (new LegacyProxyController())->forward($request);
    }
    return ApiResponse::error('页面不存在。', 404, 'not_found');
});

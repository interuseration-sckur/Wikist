<?php

namespace app\controller;

use support\Request;
use support\Response;

final class PassportPageController
{
    public function index(Request $request): Response
    {
        if (!is_file(base_path('../config/site.config.json'))) {
            return redirect('/install.html');
        }
        return response()->file(base_path('../public/passport/index.html'));
    }
}

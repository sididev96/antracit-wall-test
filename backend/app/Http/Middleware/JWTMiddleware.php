<?php

namespace App\Http\Middleware;

use Closure;
use Exception;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Tymon\JWTAuth\Facades\JWTAuth;
use Tymon\JWTAuth\Exceptions\TokenExpiredException;
use Tymon\JWTAuth\Exceptions\TokenInvalidException;

class JWTMiddleware
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        try {
            $user = JWTAuth::parseToken()->authenticate();
            
            if (!$user) {
                return response()->json([
                    'error' => 'User not found',
                    'message' => 'The authenticated user could not be found.',
                ], 401);
            }
        } catch (TokenExpiredException $e) {
            return response()->json([
                'error' => 'Token expired',
                'message' => 'Your session has expired. Please login again.',
            ], 401);
        } catch (TokenInvalidException $e) {
            return response()->json([
                'error' => 'Token invalid',
                'message' => 'The provided token is invalid.',
            ], 401);
        } catch (Exception $e) {
            return response()->json([
                'error' => 'Authorization error',
                'message' => 'Authorization token not found.',
            ], 401);
        }

        return $next($request);
    }
}

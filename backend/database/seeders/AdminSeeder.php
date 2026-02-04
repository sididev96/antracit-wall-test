<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class AdminSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // Create or update the admin user
        User::updateOrCreate(
            ['email' => env('ADMIN_EMAIL', 'admin@antracit.com')],
            [
                'name' => 'Admin',
                'password' => Hash::make(env('ADMIN_PASSWORD', 'changeme123')),
            ]
        );

        $this->command->info('Admin user created/updated successfully.');
        $this->command->info('Email: ' . env('ADMIN_EMAIL', 'admin@antracit.com'));
        $this->command->warn('Remember to change the default password!');
    }
}

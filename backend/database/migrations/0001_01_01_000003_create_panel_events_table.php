<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('panel_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('panel_id')->constrained()->onDelete('cascade');
            $table->string('event_type', 50); // impression, selection, visualization
            $table->string('session_id', 100)->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('created_at');

            // Indexes for analytics queries
            $table->index(['panel_id', 'event_type', 'created_at']);
            $table->index(['event_type', 'created_at']);
            $table->index('session_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('panel_events');
    }
};

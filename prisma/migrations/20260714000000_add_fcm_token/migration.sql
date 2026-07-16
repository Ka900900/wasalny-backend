-- Add FCM token column to User for push notifications
ALTER TABLE "User" ADD COLUMN "fcm_token" TEXT;

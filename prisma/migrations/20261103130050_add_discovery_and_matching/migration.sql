-- CreateEnum
CREATE TYPE "GenderIdentity" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "RelationshipIntent" AS ENUM ('FRIENDSHIP', 'DATING', 'BOTH');

-- CreateEnum
CREATE TYPE "LikeIntent" AS ENUM ('FRIENDSHIP', 'DATING');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('HARASSMENT', 'FAKE_PROFILE', 'SCAM_OR_FRAUD', 'INAPPROPRIATE_CONTENT', 'UNDERAGE_USER', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "gender" "GenderIdentity",
ADD COLUMN     "relationshipIntent" "RelationshipIntent" NOT NULL DEFAULT 'BOTH',
ADD COLUMN     "showGender" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DiscoveryPreference" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "minimumAge" INTEGER NOT NULL DEFAULT 18,
    "maximumAge" INTEGER NOT NULL DEFAULT 99,
    "preferredGenders" "GenderIdentity"[] DEFAULT ARRAY[]::"GenderIdentity"[],
    "preferredCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedCountries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredInterests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileLike" (
    "id" TEXT NOT NULL,
    "fromProfileId" TEXT NOT NULL,
    "toProfileId" TEXT NOT NULL,
    "intent" "LikeIntent" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "profileAId" TEXT NOT NULL,
    "profileBId" TEXT NOT NULL,
    "intent" "LikeIntent" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileBlock" (
    "id" TEXT NOT NULL,
    "blockerProfileId" TEXT NOT NULL,
    "blockedProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileReport" (
    "id" TEXT NOT NULL,
    "reporterProfileId" TEXT NOT NULL,
    "reportedProfileId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryPreference_profileId_key" ON "DiscoveryPreference"("profileId");

-- CreateIndex
CREATE INDEX "DiscoveryPreference_minimumAge_maximumAge_idx" ON "DiscoveryPreference"("minimumAge", "maximumAge");

-- CreateIndex
CREATE INDEX "ProfileLike_toProfileId_createdAt_idx" ON "ProfileLike"("toProfileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileLike_fromProfileId_toProfileId_key" ON "ProfileLike"("fromProfileId", "toProfileId");

-- CreateIndex
CREATE INDEX "Match_profileAId_createdAt_idx" ON "Match"("profileAId", "createdAt");

-- CreateIndex
CREATE INDEX "Match_profileBId_createdAt_idx" ON "Match"("profileBId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_profileAId_profileBId_key" ON "Match"("profileAId", "profileBId");

-- CreateIndex
CREATE INDEX "ProfileBlock_blockedProfileId_idx" ON "ProfileBlock"("blockedProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileBlock_blockerProfileId_blockedProfileId_key" ON "ProfileBlock"("blockerProfileId", "blockedProfileId");

-- CreateIndex
CREATE INDEX "ProfileReport_reportedProfileId_status_idx" ON "ProfileReport"("reportedProfileId", "status");

-- CreateIndex
CREATE INDEX "ProfileReport_reporterProfileId_createdAt_idx" ON "ProfileReport"("reporterProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "Profile_relationshipIntent_idx" ON "Profile"("relationshipIntent");

-- AddForeignKey
ALTER TABLE "DiscoveryPreference" ADD CONSTRAINT "DiscoveryPreference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileLike" ADD CONSTRAINT "ProfileLike_fromProfileId_fkey" FOREIGN KEY ("fromProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileLike" ADD CONSTRAINT "ProfileLike_toProfileId_fkey" FOREIGN KEY ("toProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_profileAId_fkey" FOREIGN KEY ("profileAId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_profileBId_fkey" FOREIGN KEY ("profileBId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileBlock" ADD CONSTRAINT "ProfileBlock_blockerProfileId_fkey" FOREIGN KEY ("blockerProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileBlock" ADD CONSTRAINT "ProfileBlock_blockedProfileId_fkey" FOREIGN KEY ("blockedProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileReport" ADD CONSTRAINT "ProfileReport_reporterProfileId_fkey" FOREIGN KEY ("reporterProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileReport" ADD CONSTRAINT "ProfileReport_reportedProfileId_fkey" FOREIGN KEY ("reportedProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

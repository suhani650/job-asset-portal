-- MySQL / MariaDB schema for the Asset Portal (generated from prisma/schema.prisma)

CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191),
    `passwordHash` VARCHAR(191) NOT NULL,
    `refreshTokenHash` VARCHAR(191),
    `role` ENUM('SUPER_ADMIN', 'ADMIN', 'TRAINER', 'CANDIDATE') NOT NULL DEFAULT 'CANDIDATE',
    `isActive` BOOLEAN NOT NULL DEFAULT 1,
    `applicantStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `resumePath` VARCHAR(191),
    `resumeName` VARCHAR(191),
    `reviewRemarks` TEXT,
    `reviewedAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CandidateProfile` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `dob` DATETIME(3),
    `gender` VARCHAR(191),
    `altMobile` VARCHAR(191),
    `address` TEXT,
    `city` VARCHAR(191),
    `state` VARCHAR(191),
    `pincode` VARCHAR(191),
    `qualification` VARCHAR(191),
    `course` VARCHAR(191),
    `college` VARCHAR(191),
    `passingYear` INTEGER,
    `score` VARCHAR(191),
    `skills` TEXT,
    `experienceType` VARCHAR(191),
    `expYears` DOUBLE,
    `currentCompany` VARCHAR(191),
    `noticePeriod` VARCHAR(191),
    `interest` VARCHAR(191),
    `jobRole` VARCHAR(191),
    `prefLocation` VARCHAR(191),
    `expectedSalary` INTEGER,
    `relocate` VARCHAR(191),
    `linkedin` VARCHAR(191),
    `source` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PasswordReset` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Track` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT,
    `durationWeeks` INTEGER NOT NULL DEFAULT 12,
    `fee` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Application` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `trackId` VARCHAR(191) NOT NULL,
    `status` ENUM('APPLIED', 'TEST_COMPLETED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'SELECTED', 'FEE_PAID', 'BOND_SIGNED', 'IN_TRAINING', 'READY_FOR_PLACEMENT', 'PLACED', 'REJECTED') NOT NULL DEFAULT 'APPLIED',
    `statement` TEXT,
    `resumeUrl` TEXT,
    `remarks` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Test` (
    `id` VARCHAR(191) NOT NULL,
    `trackId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `durationMins` INTEGER NOT NULL DEFAULT 30,
    `passPercent` INTEGER NOT NULL DEFAULT 50,
    `isActive` BOOLEAN NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Question` (
    `id` VARCHAR(191) NOT NULL,
    `testId` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `options` JSON NOT NULL,
    `correctIndex` INTEGER NOT NULL,
    `marks` INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TestAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `testId` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `submittedAt` DATETIME(3),
    `answers` JSON,
    `score` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `percent` DOUBLE NOT NULL DEFAULT 0,
    `passed` BOOLEAN NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Interview` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `interviewerId` VARCHAR(191),
    `scheduledAt` DATETIME(3) NOT NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'ONLINE',
    `link` TEXT,
    `status` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `rating` INTEGER,
    `notes` TEXT,
    `result` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FeePlan` (
    `id` VARCHAR(191) NOT NULL,
    `trackId` VARCHAR(191) NOT NULL,
    `planType` ENUM('ONE_TIME', 'INSTALLMENTS') NOT NULL DEFAULT 'ONE_TIME',
    `totalAmount` INTEGER NOT NULL,
    `installments` INTEGER NOT NULL DEFAULT 1,
    `perInstallment` INTEGER,
    `discountPct` DOUBLE,
    `lateFee` INTEGER,
    `isActive` BOOLEAN NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Payment` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `feePlanId` VARCHAR(191),
    `installmentNo` INTEGER NOT NULL DEFAULT 1,
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `status` ENUM('CREATED', 'PAID', 'FAILED') NOT NULL DEFAULT 'CREATED',
    `mode` ENUM('ONLINE', 'CASH', 'BANK_TRANSFER') NOT NULL DEFAULT 'ONLINE',
    `razorpayOrderId` VARCHAR(191),
    `razorpayPaymentId` VARCHAR(191),
    `receiptNo` VARCHAR(191),
    `adminNotes` TEXT,
    `paidAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Bond` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `months` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `terms` LONGTEXT NOT NULL,
    `status` ENUM('PENDING', 'SIGNED') NOT NULL DEFAULT 'PENDING',
    `otpHash` VARCHAR(191),
    `otpExpiresAt` DATETIME(3),
    `signedAt` DATETIME(3),
    `signedIp` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Batch` (
    `id` VARCHAR(191) NOT NULL,
    `trackId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `trainerId` VARCHAR(191),
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `BatchMember` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `contentUrl` TEXT,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Attendance` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `present` BOOLEAN NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Assignment` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT,
    `dueDate` DATETIME(3) NOT NULL,
    `maxMarks` INTEGER NOT NULL DEFAULT 100,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Submission` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `text` TEXT,
    `fileUrl` TEXT,
    `marks` INTEGER,
    `feedback` TEXT,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Progress` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `attendancePct` DOUBLE NOT NULL DEFAULT 0,
    `assignmentPct` DOUBLE NOT NULL DEFAULT 0,
    `testPct` DOUBLE NOT NULL DEFAULT 0,
    `trainerRating` INTEGER NOT NULL DEFAULT 0,
    `overallPct` DOUBLE NOT NULL DEFAULT 0,
    `certificateNo` VARCHAR(191),
    `certifiedAt` DATETIME(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Client` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191),
    `contactEmail` VARCHAR(191),
    `contactPhone` VARCHAR(191),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Requirement` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT,
    `skills` JSON NOT NULL,
    `positions` INTEGER NOT NULL DEFAULT 1,
    `filled` INTEGER NOT NULL DEFAULT 0,
    `deadline` DATETIME(3),
    `isActive` BOOLEAN NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Placement` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `requirementId` VARCHAR(191),
    `roleTitle` VARCHAR(191) NOT NULL,
    `packageLpa` DOUBLE,
    `status` ENUM('OFFERED', 'PLACED') NOT NULL DEFAULT 'OFFERED',
    `placedAt` DATETIME(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `read` BOOLEAN NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Policy` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PolicyAcceptance` (
    `id` VARCHAR(191) NOT NULL,
    `policyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TrainingModule` (
    `id` VARCHAR(191) NOT NULL,
    `trackId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT,
    `type` ENUM('VIDEO', 'PDF', 'LINK', 'NOTES') NOT NULL DEFAULT 'LINK',
    `url` TEXT,
    `position` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Document` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `filePath` TEXT NOT NULL,
    `mimeType` VARCHAR(191),
    `size` INTEGER,
    `status` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `remarks` TEXT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `User_email_key` ON `User`(`email`);
CREATE INDEX `User_role_idx` ON `User`(`role`);
CREATE INDEX `User_applicantStatus_idx` ON `User`(`applicantStatus`);
CREATE UNIQUE INDEX `CandidateProfile_userId_key` ON `CandidateProfile`(`userId`);
CREATE UNIQUE INDEX `PasswordReset_tokenHash_key` ON `PasswordReset`(`tokenHash`);
CREATE INDEX `PasswordReset_userId_idx` ON `PasswordReset`(`userId`);
CREATE UNIQUE INDEX `Track_name_key` ON `Track`(`name`);
CREATE UNIQUE INDEX `Application_userId_trackId_key` ON `Application`(`userId`, `trackId`);
CREATE INDEX `Application_status_idx` ON `Application`(`status`);
CREATE INDEX `Application_trackId_idx` ON `Application`(`trackId`);
CREATE INDEX `Application_userId_idx` ON `Application`(`userId`);
CREATE INDEX `Test_trackId_idx` ON `Test`(`trackId`);
CREATE INDEX `Question_testId_idx` ON `Question`(`testId`);
CREATE UNIQUE INDEX `TestAttempt_testId_applicationId_key` ON `TestAttempt`(`testId`, `applicationId`);
CREATE INDEX `TestAttempt_userId_idx` ON `TestAttempt`(`userId`);
CREATE INDEX `Interview_applicationId_idx` ON `Interview`(`applicationId`);
CREATE INDEX `Interview_interviewerId_idx` ON `Interview`(`interviewerId`);
CREATE INDEX `FeePlan_trackId_idx` ON `FeePlan`(`trackId`);
CREATE UNIQUE INDEX `Payment_razorpayOrderId_key` ON `Payment`(`razorpayOrderId`);
CREATE UNIQUE INDEX `Payment_receiptNo_key` ON `Payment`(`receiptNo`);
CREATE INDEX `Payment_applicationId_idx` ON `Payment`(`applicationId`);
CREATE INDEX `Payment_userId_idx` ON `Payment`(`userId`);
CREATE INDEX `Payment_status_createdAt_idx` ON `Payment`(`status`, `createdAt`);
CREATE UNIQUE INDEX `Bond_applicationId_key` ON `Bond`(`applicationId`);
CREATE INDEX `Bond_userId_idx` ON `Bond`(`userId`);
CREATE INDEX `Batch_trackId_idx` ON `Batch`(`trackId`);
CREATE INDEX `Batch_trainerId_idx` ON `Batch`(`trainerId`);
CREATE UNIQUE INDEX `BatchMember_batchId_applicationId_key` ON `BatchMember`(`batchId`, `applicationId`);
CREATE INDEX `BatchMember_userId_idx` ON `BatchMember`(`userId`);
CREATE INDEX `Session_batchId_date_idx` ON `Session`(`batchId`, `date`);
CREATE UNIQUE INDEX `Attendance_sessionId_userId_key` ON `Attendance`(`sessionId`, `userId`);
CREATE INDEX `Attendance_userId_idx` ON `Attendance`(`userId`);
CREATE INDEX `Assignment_batchId_idx` ON `Assignment`(`batchId`);
CREATE UNIQUE INDEX `Submission_assignmentId_userId_key` ON `Submission`(`assignmentId`, `userId`);
CREATE INDEX `Submission_userId_idx` ON `Submission`(`userId`);
CREATE UNIQUE INDEX `Progress_applicationId_key` ON `Progress`(`applicationId`);
CREATE UNIQUE INDEX `Progress_certificateNo_key` ON `Progress`(`certificateNo`);
CREATE INDEX `Progress_userId_idx` ON `Progress`(`userId`);
CREATE INDEX `Requirement_clientId_idx` ON `Requirement`(`clientId`);
CREATE UNIQUE INDEX `Placement_applicationId_key` ON `Placement`(`applicationId`);
CREATE INDEX `Placement_clientId_idx` ON `Placement`(`clientId`);
CREATE INDEX `Placement_userId_idx` ON `Placement`(`userId`);
CREATE INDEX `Notification_userId_read_idx` ON `Notification`(`userId`, `read`);
CREATE INDEX `Notification_userId_createdAt_idx` ON `Notification`(`userId`, `createdAt`);
CREATE UNIQUE INDEX `PolicyAcceptance_policyId_userId_key` ON `PolicyAcceptance`(`policyId`, `userId`);
CREATE INDEX `PolicyAcceptance_userId_idx` ON `PolicyAcceptance`(`userId`);
CREATE INDEX `TrainingModule_trackId_position_idx` ON `TrainingModule`(`trackId`, `position`);
CREATE INDEX `Document_userId_idx` ON `Document`(`userId`);

ALTER TABLE `CandidateProfile` ADD CONSTRAINT `CandidateProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PasswordReset` ADD CONSTRAINT `PasswordReset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Application` ADD CONSTRAINT `Application_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Application` ADD CONSTRAINT `Application_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Test` ADD CONSTRAINT `Test_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Question` ADD CONSTRAINT `Question_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `Test`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TestAttempt` ADD CONSTRAINT `TestAttempt_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `Test`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TestAttempt` ADD CONSTRAINT `TestAttempt_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TestAttempt` ADD CONSTRAINT `TestAttempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Interview` ADD CONSTRAINT `Interview_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Interview` ADD CONSTRAINT `Interview_interviewerId_fkey` FOREIGN KEY (`interviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `FeePlan` ADD CONSTRAINT `FeePlan_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_feePlanId_fkey` FOREIGN KEY (`feePlanId`) REFERENCES `FeePlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Bond` ADD CONSTRAINT `Bond_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Bond` ADD CONSTRAINT `Bond_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Batch` ADD CONSTRAINT `Batch_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Batch` ADD CONSTRAINT `Batch_trainerId_fkey` FOREIGN KEY (`trainerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `BatchMember` ADD CONSTRAINT `BatchMember_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `Batch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BatchMember` ADD CONSTRAINT `BatchMember_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `BatchMember` ADD CONSTRAINT `BatchMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Session` ADD CONSTRAINT `Session_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `Batch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `Batch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `Assignment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Progress` ADD CONSTRAINT `Progress_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Progress` ADD CONSTRAINT `Progress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Requirement` ADD CONSTRAINT `Requirement_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Placement` ADD CONSTRAINT `Placement_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Placement` ADD CONSTRAINT `Placement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Placement` ADD CONSTRAINT `Placement_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Client`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Placement` ADD CONSTRAINT `Placement_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PolicyAcceptance` ADD CONSTRAINT `PolicyAcceptance_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `Policy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PolicyAcceptance` ADD CONSTRAINT `PolicyAcceptance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TrainingModule` ADD CONSTRAINT `TrainingModule_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Document` ADD CONSTRAINT `Document_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

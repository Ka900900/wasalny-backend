const REQUIRED_DOCUMENT_FIELDS = [
  'idPhotoFront',
  'idPhotoBack',
  'licensePhoto',
  'facePhoto',
  'insurancePhoto',
  'idCardBackUrl',
  'licenseBackUrl',
  'vehicleLicenseFrontUrl',
  'vehicleLicenseBackUrl',
  'licenseNumber',
  'criminalRecordUrl',
  'drugTestUrl',
];

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

function areDocumentsComplete(profile) {
  return REQUIRED_DOCUMENT_FIELDS.every((field) => {
    const value = profile[field];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function getGracePeriodEndDate(profile) {
  if (profile.gracePeriodEndDate) {
    return new Date(profile.gracePeriodEndDate);
  }

  const createdAt = profile.user?.createdAt || profile.userCreatedAt || profile.createdAt;
  if (!createdAt) {
    return null;
  }

  return new Date(new Date(createdAt).getTime() + GRACE_PERIOD_MS);
}

function calculateCaptainStatus(profile, now = new Date()) {
  const status = profile.verificationStatus;

  if (status === 'PENDING') {
    if (areDocumentsComplete(profile)) {
      return 'APPROVED';
    }

    const gracePeriodEndDate = getGracePeriodEndDate(profile);
    return gracePeriodEndDate && now > gracePeriodEndDate ? 'DOCS_EXPIRED' : status;
  }

  return status;
}

function withCalculatedCaptainStatus(profile, now = new Date()) {
  const status = calculateCaptainStatus(profile, now);
  return { ...profile, verificationStatus: status, status };
}

module.exports = {
  REQUIRED_DOCUMENT_FIELDS,
  areDocumentsComplete,
  calculateCaptainStatus,
  getGracePeriodEndDate,
  withCalculatedCaptainStatus,
};
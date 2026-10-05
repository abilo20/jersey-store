import multer from 'multer';
import path from 'path';
import fs from 'fs';

function makeStorage(subfolder: string) {
  const uploadDir = path.resolve(process.cwd(), 'uploads', subfolder);
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  return multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${subfolder}-${uniqueSuffix}${ext}`);
    }
  });
}

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, JPEG, PNG or WebP image files are allowed'));
  }
};

export const uploadPaymentProof = multer({
  storage: makeStorage('payments'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter
});

export const uploadReviewImage = multer({
  storage: makeStorage('reviews'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

export const uploadProductImage = multer({
  storage: makeStorage('products'),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter
});

export const uploadBannerImage = multer({
  storage: makeStorage('banners'),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter
});

export const uploadProfileImage = multer({
  storage: makeStorage('profiles'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

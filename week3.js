// DATAMOSH(ish) WEBCAM
// Built from: Shiffman's motion detection (compare this frame to the previous frame)

let video;
let prev;
let threshold = 100;
let blockSize = 4;
let smearAmount = 90;
let refreshChance = 0.98;
// from Shiffman's motion tracker
let motionX = 0;
let motionY = 0;
let lerpX = 0;
let lerpY = 0;
let started = false;

function setup() {
  createCanvas(640, 480);
  pixelDensity(1);
  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();
  prev = createImage(width, height);
  background(0);
}

function draw() {
  video.loadPixels();
  prev.loadPixels();

  if (video.pixels.length === 0) return;



  if (!started) {
    image(video, 0, 0);
    started = true;
  }
//the frames after moving
  let movingBlocks = [];
  let avgX = 0;
  let avgY = 0;
  let count = 0;

  for (let x = 0; x < width; x += blockSize) {
    for (let y = 0; y < height; y += blockSize) {
      let cx = x + blockSize / 2;
      let cy = y + blockSize / 2;
      let index = (cx + cy * width) * 4;

      let r1 = video.pixels[index];
      let g1 = video.pixels[index +2];
      let b1 = video.pixels[index +1];
      let r2 = prev.pixels[index];
      let g2 = prev.pixels[index +2];
      let b2 = prev.pixels[index +1];

      // invert(255 - color) then average
      let avgR = (r1 + (255 - r2)) / 2;
      let avgG = (g1 + (255 - g2)) / 2;
      let avgB = (b1 + (255 - b2)) / 2;

      let change = abs(avgR - 127.5) + abs(avgG - 127.5) + abs(avgB - 127.5);

      if (change > threshold) {
        movingBlocks.push({ x: x, y: y });
        avgX += cx;
        avgY += cy;
        count++;
      }
    }
  }

  // find the center of the motion (Shiffman's code)
  if (count > 5) {
    motionX = avgX / count;
    motionY = avgY / count;
  }

  let oldX = lerpX;
  let oldY = lerpY;
  lerpX = lerpX, motionX, 0.1;
  lerpY = lerpY, motionY, 0.1;

  // which way is the motion center travelling
  let pushX = constrain((lerpX - oldX) * smearAmount, -blockSize, blockSize);
  let pushY = constrain((lerpY - oldY) * smearAmount, -blockSize, blockSize);

 //moshing
 blendMode(DIFFERENCE);
  for (let b of movingBlocks) {
    if (random() < refreshChance) {
      // sometimes keep the real webcam block back in
      copy(video, b.x, b.y, blockSize, blockSize, b.x, b.y, blockSize, blockSize);
    } else {
      copy(b.x - pushX, b.y - pushY, blockSize, blockSize,
           b.x, b.y, blockSize, blockSize);
    }

  }
 blendMode(BLEND);
  prev.copy(video, 0, 0, width, height, 0, 0, width, height);
}

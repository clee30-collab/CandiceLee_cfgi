let step = 1;   // increments
let folder = "week6_images/";


let images = [
    "1-happy-dog.jpg", "2-happy-dog.jpg", "3-happy-dog.jpg", "4-happy-dog.jpg",
    "5-unhappy-human.jpg", "6-unhappy-human.jpg", "7-unhappy-human.jpg",
    "8-unhappy-human.jpg", "9-happy-dog.jpg", "9-unhappy-human.jpg",
    "10-happy-human.jpg", "11-unhappy-human.jpg", "12-unhappy-dog.jpg",
    "13-unhappy-human.jpg", "14-unhappy-human.jpg", "15-happy-dog.jpg",
    "16-unhappy-human.jpg", "17-unhappy-human.jpg", "18-unhappy-dog.jpg",
    "19-happy-human.jpg", "20-unhappy-human.jpg", "21-unhappy-dog.jpg",
    "22-happy-dog.jpg", "23-unhappy-human.jpg", "24-happy-human.jpg",
    "25-unhappy-human.jpg", "26-unhappy-human.jpg", "27-unhappy-human.jpg",
    "28-unhappy-human.jpg", "29-unhappy-human.jpg", "30-unhappy-dog.jpg",
    "31-unhappy-human.jpg", "32-happy-human.jpg"
];


let volumeText = document.getElementById("volume");
let minusButton = document.getElementById("minus");
let plusButton = document.getElementById("plus");
let overlay = document.getElementById("overlay");
let headerSmall = document.getElementById("header-small");
let headerBig = document.getElementById("header-big");
let grid = document.getElementById("grid");
let errorText = document.getElementById("error");
let verifyButton = document.getElementById("verify");
let song = document.getElementById("song");

//randomize the volume
let volume;
if (Math.random() < 0.5) {
    volume = 0;
} else {
    volume = 100;
}

let pendingChange = 0;

function showVolume() {
    volumeText.textContent = volume + "%";
    song.volume = volume / 100;   
}

showVolume();


song.play().catch(function () {});
document.addEventListener("click", function () {
    song.play();
});
document.addEventListener("keydown", function () {
    song.play();
});

song.addEventListener("pause", function () {
    song.play();
});

minusButton.addEventListener("click", function () {
    pendingChange = -step;
    openCaptcha();
});
plusButton.addEventListener("click", function () {
    pendingChange = step;
    openCaptcha();
});

//the actual captccha
let currentQuestion = "";   // "dogs", "happy" or "unhappy"
function isCorrect(file, question) {
    if (question === "dogs") {
        return file.includes("dog");
    }
    if (question === "happy") {
        return file.includes("-happy");
    }
    if (question === "unhappy") {
        return file.includes("-unhappy");
    }
}
function shuffle(list) {
    return list.sort(function () {
        return Math.random() - 0.5;
    });
}

function openCaptcha() {
    newCaptcha();
    overlay.style.display = "block";
}

function closeCaptcha() {
    overlay.style.display = "none";
}

function newCaptcha() {
    errorText.style.display = "none";
    let questions = ["dogs", "happy", "unhappy"];
    currentQuestion = questions[Math.floor(Math.random() * questions.length)];

    if (currentQuestion === "dogs") {
        headerSmall.textContent = "Select all images with";
        headerBig.textContent = "dogs";
    } else if (currentQuestion === "happy") {
        headerSmall.textContent = "Select all images of only";
        headerBig.textContent = "happy facial expressions";
    } else {
        headerSmall.textContent = "Select all images that contain only";
        headerBig.textContent = "unhappy facial expressions";
    }
    let right = [];
    let wrong = [];
    for (let file of images) {
        if (isCorrect(file, currentQuestion)) {
            right.push(file);
        } else {
            wrong.push(file);
        }
    }

    let nine = shuffle(right).slice(0, 3).concat(shuffle(wrong).slice(0, 6));
    nine = shuffle(nine);
    grid.innerHTML = "";
    for (let file of nine) {
        let tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.file = file;   // remember which image this tile is

        let img = document.createElement("img");
        img.src = folder + file;

        let check = document.createElement("div");
        check.className = "check";
        check.textContent = "✓";

        tile.appendChild(img);
        tile.appendChild(check);

        tile.addEventListener("click", function () {
            tile.classList.toggle("selected");
        });

        grid.appendChild(tile);
    }
}

verifyButton.addEventListener("click", function () {
    let passed = true;
    let tiles = grid.querySelectorAll(".tile");
    for (let tile of tiles) {
        let shouldBeSelected = isCorrect(tile.dataset.file, currentQuestion);
        let isSelected = tile.classList.contains("selected");
        if (shouldBeSelected !== isSelected) {
            passed = false;
        }
    }

    if (passed) {
        volume = volume + pendingChange;
        if (volume > 100) volume = 100;
        if (volume < 0) volume = 0;
        showVolume();
        closeCaptcha();
    } else {
        //if false/incorrect give new one
        newCaptcha();
        errorText.style.display = "block";
    }
});

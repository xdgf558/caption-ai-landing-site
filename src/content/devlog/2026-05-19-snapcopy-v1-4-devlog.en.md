---
title: "snapCopy V1.4 Dev Log: Cleaning the Foundation for Photo Understanding"
postSlug: "2026-05-19-snapcopy-v1-4-devlog"
description: "snapCopy V1.4 is not a flashy feature release. It focuses on the foundation behind photo understanding: the first cleanup pass for the v1 training images, 249 usable images kept, 11 removed, and a clearer dataset flow for future Core ML scene recognition."
pubDate: "2026-05-19"
status: "testing"
language: "en"
tags: ["snapCopy", "App Build", "V1.4", "TestFlight", "AI Tools", "Scene Recognition", "Station Cat"]
draft: false
---

# snapCopy V1.4 Dev Log: Cleaning the Foundation for Photo Understanding

For V1.4, I did not start by adding a shiny new button.

This is not the kind of release where people open the app and immediately see a big new feature.

More accurately, this version works on a quiet but important foundation for snapCopy:

**photo understanding.**

snapCopy has a simple goal: take a photo, then help you write a caption that is easier to share.

But the first step is not really “writing.”

The first step is:

**did the app understand the photo at all?**

If the photo is coffee, it should not treat it like a random desk image.
If it is a street scene from a walk, it should not write breakfast captions.
If there is a cat in the photo, it should not cover the moment with a loud template.

So V1.4 is a quieter release.

It cleans up the first batch of images used to train and evaluate scene recognition.

## Cleaning 260 v1 Training Images

snapCopy already had a first v1 image set with 260 images.

They were organized into 13 everyday scene categories:

breakfast, cafe, walking, street, travel, pet, outfit, fitness, sunset, home, work, food, and unknown.

These categories are ordinary, which is exactly the point. They are the kinds of photos snapCopy will actually see.

But datasets have one small problem that can become a big problem:

**if the wrong images are inside, the model learns the wrong thing.**

A prompt screenshot should not be treated as breakfast.
A dog photo should not sit inside a walking category.
A travel photo that is really a street scene should probably be labeled street.
Generated instruction cards should not become training examples for real-life photos.

If those samples stay in the set, the model does not get smarter.

It gets confused.

So this version starts with one manual cleanup pass.

## Cleanup Result

After the first pass:

- The original 260 images were not deleted or overwritten.
- 249 images were kept for future training.
- 11 images were removed from the clean training set, mostly prompt screenshots or data-card artifacts.
- A few mislabeled images were corrected.
- Low-light, compressed, and slightly blurry images were kept when they looked like realistic user photos, with quality notes attached.

I like this approach.

snapCopy is not only for perfect photos.

Real photos are often a little dark, a little soft, or a little plain.
Breakfast does not always look like a menu shot.
Desks are not always tidy.
Cats do not wait for composition.

If a model only sees clean, pretty demo images, it can become fragile in real use.

So this cleanup is not about turning the dataset into a beautiful photo album.

It is about making the dataset:

**trusted, traceable, and ready to grow.**

## A More Repeatable Dataset Flow

V1.4 also makes the dataset work more structured.

Now the project has:

- a v1 raw manifest
- a v1 clean manifest
- per-class contact sheets
- a cleanup report
- a trainable v1_clean directory
- a v2 dataset expansion plan
- a Create ML training guide
- a model evaluation template
- App-side Core ML integration notes

None of this looks like an app feature.

But for a small AI tool, it matters.

Future model improvements should not depend only on “it feels better.”

The project should be able to answer:

Which data did this version use?
Which images were kept?
Which images were excluded?
Which labels were corrected?
Why were some low-light or blurry samples kept?
What will the next model be compared against?

When those questions have answers, photo understanding starts to have a real foundation.

## Preparing the App Side

This release was not only about folders.

The app side is also prepared for a future local scene model.

snapCopy now has a clearer place for a Core ML custom scene classifier.

When a trained scene model is ready, it can work together with Apple Vision, OCR, and rule-based signals.

The direction is:

When Core ML is available, the local model becomes the main signal.
Vision labels, OCR, and user corrections help refine the result.
When no model is bundled, the app still falls back to the current Vision rules and OCR flow.
In other words, the app should not break just because a model is not ready yet.

I also updated the photo understanding diagnostic view so future model testing has better clues:

Core ML Top-3 predictions, final scene, confidence, manual scene suggestion, local evaluation state, and caption rating state.

This is not a feature for every user.

It is more like a small lamp during development.

When a caption does not match the photo, I can look back and ask:

Was the photo misunderstood?
Was the scene right, but the caption drifted?
Was the model confidence too low, and should the user choose a scene manually?

## Why This Belongs in the Dev Log

From the outside, V1.4 may not look very loud.

But for snapCopy, this step matters.

It decides whether future captions can feel like they were written while looking at the photo, not pasted from a template.

A coffee photo is not only coffee.

It may be morning, a table, warm light, a quiet pause before the day starts.

A cat photo is not only a pet.

It may be a window, low light, a lazy posture, one second that happened to be caught.

If photo understanding can hold a few more of those details, the captions have a better chance of staying close to the image.

That is what V1.4 is trying to make possible.

## Next

Next, I want to train a new scene classifier using the cleaned v1_clean dataset.

This model does not need to be complicated yet.

I first want to see:

Can it separate everyday scenes reliably?
Which categories are easy to confuse?
Does the cleaned data make evaluation more stable?
Do low-light, compressed, or blurry samples hurt the model, or help it handle real photos?
After the model is connected to the app, do captions become closer to the photo?

If the result is useful, I will expand toward v2.

v2 will need more photos, more edge cases, and stricter evaluation.

But for now, the first foundation is in place.

It is not flashy.

It is a bit like tidying a drawer.

But reliable everyday tools often begin in those quiet places.

snapCopy will keep growing slowly:

understand the photo first,
write closer captions next,
and eventually help people share small moments with a little less friction.

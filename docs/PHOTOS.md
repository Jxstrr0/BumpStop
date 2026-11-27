# The truck card and photo mode (plan PR 12b)

Two ways to show a truck off. Both make a PNG and hand it to the phone's
share sheet (Messages, Photos, Save Image), or download it where there's no
share sheet (most computers). Neither ever uploads anything: the picture is
made on the phone.

## The truck card

On the build screen, under **Share this build**, open **Truck card**.

- A 1080 × 1350 picture (the shape phones and feeds show whole) in the
  roadbook look, light or dark with the phone: BUMP STOP on its highlighter
  swipe, the class and year, the truck itself drawn by the build screen's 3D
  view from the front three-quarter (with its own parts and ride height),
  its weight against the class window, its ride height, and seven parts
  (front and rear suspension, dampers, bump stops, tires, axles, engine).
- The footer has the address, the credit line `© 2026 Kelbo / Longlight
  Interactive` in Space Grotesk and the official Longlight logo file (never
  redrawn), as the branding rules ask for a studio piece.
- **Share card** sends the picture with a line of text holding the truck's
  `BMPT1:` build code, so a friend can paste it under Share this build and
  drive the same truck. Money isn't on the card (its name is still a
  placeholder).
- The preview redraws a moment after any part or setting changes while the
  card is open.

Code: `src/ui/truckCard.ts` (drawing and the block), `Garage.snapshot` in
`src/render/garage.ts` (the 3D picture).

## Photo mode

Under the 3D view on a rig run and on a raid's stage highlight (at the
right-hand edge when they're full page), **Photo mode** freezes the clip where it is and opens the view full screen:

- **Moment** scrubs back and forth through the clip (about 2.5 seconds of a
  live run, 3 seconds of a break replay), to catch the truck in the air or
  a wheel at full stretch. At the very end of a break replay the break shows
  (the flat, the flopping wheel, the torn mount).
- **Turn** walks the camera round the truck; **Zoom** goes closer or
  further. Dragging the picture turns and lifts the camera, and two fingers
  pinch to zoom.
- **Take photo** draws the view at 2,048 pixels on its longer side with a
  small BUMP STOP mark in the corner and shares or downloads it.
- **Done** (or Escape) goes back. The run or the raid kept going while the
  photo was framed; the view picks up with the newest clip.

If the player had swung the camera round (the swing-around camera, see
`docs/3D.md`), photo mode starts from that view, and the swing camera
carries on after **Done**.

The sliders keep photo mode usable without dragging. Limits are in
`src/data/graphics.ts` (`PHOTO_LIFT`, `PHOTO_ZOOM`). Code: `src/ui/photoMode.ts`
(the controls), `photoStart`/`photoSet`/`photoEnd`/`snapshot` in
`src/render/trackView.ts`.

## Keep for the album

In a career, photo mode also has **Keep for the album**: a smaller copy of
the shot goes in the career's album, which the hall of fame shows at the
end. See `docs/CAREER.md`, "After 2025: the hall of fame".

## Why the share is made without waiting

Phones only open the share sheet straight after a tap. Turning a canvas into
a file with `toBlob` waits, and that can use the tap up, so both buttons draw
the picture again on the spot and turn it into a file with `toDataURL`,
which doesn't wait (`src/ui/shareImage.ts`).

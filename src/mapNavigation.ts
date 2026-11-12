import type Map from 'ol/Map.js';
import Interaction from 'ol/interaction/Interaction.js';
import MouseWheelZoom from 'ol/interaction/MouseWheelZoom.js';

/** Desktop scrolling pans; browser pinch events zoom around the pointer. */
export function installMapNavigation(map: Map) {
  const view = map.getView();
  const viewport = map.getViewport()!;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interacting = false;
  let safariGesture = false;
  let previousScale = 1;
  let anchor: number[] | undefined;

  // Use the live view rather than the last rendered frame: several wheel
  // events can arrive before OpenLayers renders the next frame.
  function offsetAtPixel(x: number, y: number) {
    const resolution = view.getResolution()!;
    const rotation = view.getRotation();
    return [resolution * (x * Math.cos(rotation) + y * Math.sin(rotation)),
      resolution * (x * Math.sin(rotation) - y * Math.cos(rotation))];
  }
  function coordinateAtPixel(pixel: number[]) {
    const size = map.getSize()!;
    const offset = offsetAtPixel(pixel[0] - size[0] / 2, pixel[1] - size[1] / 2);
    return view.getCenter()!.map((value, i) => value + offset[i]);
  }

  function begin() {
    clearTimeout(timer);
    if (!interacting) {
      view.cancelAnimations();
      view.beginInteraction();
      interacting = true;
    }
  }
  function end() {
    clearTimeout(timer);
    if (interacting) view.endInteraction(150, 0, anchor);
    interacting = false;
    anchor = undefined;
  }

  // Line/page deltas come from traditional mouse wheels. Pixel deltas are
  // used by trackpads (and some smooth-scrolling mice); keep both pan axes.
  const wheelZoom = new MouseWheelZoom({condition: event => {
    const wheel = event.originalEvent as WheelEvent;
    return !safariGesture && !wheel.ctrlKey && !wheel.metaKey && wheel.deltaMode !== 0;
  }});
  const scroll = new Interaction({handleEvent: event => {
    if (event.type !== 'wheel') return true;
    const wheel = event.originalEvent as WheelEvent;
    const pinch = wheel.ctrlKey || wheel.metaKey;
    if (!pinch && wheel.deltaMode !== 0) return true;
    wheel.preventDefault();
    if (safariGesture) return false;
    if (!wheel.deltaX && !wheel.deltaY) return false;
    begin();
    if (pinch) {
      anchor = coordinateAtPixel(event.pixel);
      const unit = wheel.deltaMode === 1 ? 40 : wheel.deltaMode === 2 ? map.getSize()![1] : 1;
      view.adjustZoom(-wheel.deltaY * unit / 100, anchor);
    } else {
      anchor = undefined;
      view.adjustCenter(offsetAtPixel(wheel.deltaX, wheel.deltaY));
    }
    timer = setTimeout(end, 150);
    return false;
  }});
  map.addInteraction(wheelZoom);
  map.addInteraction(scroll);

  // Safari exposes native trackpad pinches as GestureEvents rather than
  // Ctrl+wheel. Scope cancellation to the map so page gestures still work.
  type Gesture = Event & {scale: number; clientX: number; clientY: number};
  viewport.addEventListener('gesturestart', event => {
    event.preventDefault();
    safariGesture = true;
    previousScale = 1;
    begin();
  }, {passive: false, signal: controller.signal});
  viewport.addEventListener('gesturechange', event => {
    if (!safariGesture) return;
    event.preventDefault();
    const gesture = event as Gesture;
    if (!(gesture.scale > 0) || !Number.isFinite(gesture.scale)) return;
    anchor = coordinateAtPixel(map.getEventPixel(gesture));
    view.adjustResolution(previousScale / gesture.scale, anchor);
    previousScale = gesture.scale;
  }, {passive: false, signal: controller.signal});
  viewport.addEventListener('gestureend', event => {
    event.preventDefault();
    safariGesture = false;
    end();
  }, {passive: false, signal: controller.signal});

  return () => {
    controller.abort();
    end();
    map.removeInteraction(scroll);
    map.removeInteraction(wheelZoom);
  };
}

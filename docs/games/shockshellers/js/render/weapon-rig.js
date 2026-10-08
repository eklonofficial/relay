import * as THREE from '../../vendor/three/three.module.js?v=muzthczg';
import { weaponModel } from './models.js?v=muzthczg';
import { WEAPONS } from '../sim/tuning.js?v=muzthczg';
import { RELOAD_CUES } from './reload-cues.js?v=muzthczg';
export const clampProgress = (value) => Math.max(0, Math.min(1, value));
// A weapon's imported rig and its clips (fire, inspect, the short reload and the reload from empty,
// the whisk's swing). Nothing here keeps its own time for a reload: each frame samples the clip at the
// simulation's reload progress, so the animation ends exactly when the reload does. Between ticks the
// progress is carried forward by real time (capped at a tick ahead) so it moves every frame.
export class WeaponRig {
  constructor(id, skin = 0, hands = true) {
    this.id = id;
    this.root = weaponModel(id, skin, hands);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.spec = this.root.userData.spec;
    this.clips = this.root.userData.clips;
    this.actions = this.clips.map((clip) => {
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      return a;
    });
    this.mode = '';
    this.progress = 0;
    this.fireTime = 100;
    this.lastCue = -1;
    this.sample(this.spec.short, 0);
  }
  // Pose the rig at progress (0..1) through a clip; with blend, mix that pose with a second clip's
  // ([index, progress, weight]: the weight the second one gets).
  sample(index, progress, blend = null) {
    this.mixer.stopAllAction();
    const pose = (i, f, w) => { const a = this.actions[i]; a.reset().play(); a.paused = true; a.setEffectiveWeight(w); a.time = clampProgress(f) * this.clips[i].duration; };
    pose(index, progress, blend ? 1 - blend[2] : 1);
    if (blend && blend[0] !== index) pose(blend[0], blend[1], blend[2]);
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
  }
  fire() {
    this.fireTime = 0;
  }
  // state: { dt, reload: {f, long}|null, inspect: 0..1, melee: 0..1, aim: 0..1 }. cue(sample, what) is called
  // as the reload passes each mechanical moment (reload-cues.js).
  update(state, cue) {
    this.fireTime += state.dt;
    if (state.melee > 0 && this.id === 'whisk') {
      this.mode = 'melee';
      this.sample(this.spec.fire, state.melee);
    } else if (state.reload) {
      const index = state.reload.long ? this.spec.long : this.spec.short;
      const mode = `reload:${index}`,
        target = clampProgress(state.reload.f);
      const seconds = WEAPONS[this.id].reload[state.reload.long ? 1 : 0] / 60;
      if (this.mode !== mode || target < this.target - 0.2) {
        this.progress = target;
        this.lastCue = -1;
      } else
        this.progress = Math.max(
          target,
          Math.min(target + 1 / 30 / seconds, this.progress + state.dt / seconds)
        );
      this.target = target;
      this.mode = mode;
      this.sample(index, this.progress);
      for (const [frame, sample, what] of RELOAD_CUES[this.id]?.[state.reload.long ? 1 : 0] || []) {
        const at = frame / (this.clips[index].duration * 60);
        if (at > this.lastCue && at <= this.progress) cue?.(sample, what);
      }
      this.lastCue = this.progress;
    } else if (state.inspect > 0) {
      this.mode = 'inspect';
      this.sample(this.spec.inspect, state.inspect);
    } else {
      this.mode = 'idle';
      // A shot works the action through the fire clip. Aimed, only a tenth of its kick comes
      // through (the rest of the pose stays at rest), so the gun never climbs over the sights.
      const clip = this.clips[this.spec.fire];
      if (this.fireTime < clip.duration) this.sample(this.spec.short, 0, [this.spec.fire, this.fireTime / clip.duration, 1 - 0.9 * (state.aim || 0)]);
      else this.sample(this.spec.short, 0);
    }
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.traverse((o) => {
      if (o.isSkinnedMesh) o.skeleton.dispose();
    });
  }
}

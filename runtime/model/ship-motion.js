const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const length = (v) => Math.hypot(v.x, v.y, v.z);
const approach = (current, target, amount) => current + clamp(target - current, -amount, amount);

function finiteVector(value = {}) {
  const result = { x: value.x ?? 0, y: value.y ?? 0, z: value.z ?? 0 };
  if (!Object.values(result).every(Number.isFinite))
    throw new TypeError('Motion vectors must be finite');
  return result;
}

/** Flight-assist motor. Velocity is a pilot intent, never a direct pose or sideways thrust order. */
export function stepShipMotion(ship, command = {}, dt, spec) {
  if (!Number.isFinite(dt) || dt < 0)
    throw new TypeError('Motion delta must be finite and non-negative');
  const { maxSpeed, acceleration, turnRate, angularAcceleration = turnRate } = spec ?? {};
  if (
    ![maxSpeed, acceleration, turnRate, angularAcceleration].every(
      (v) => Number.isFinite(v) && v >= 0,
    )
  )
    throw new TypeError('Motion spec requires non-negative finite limits');
  const position = finiteVector(ship);
  const current = finiteVector({ x: ship.vx, y: ship.vy, z: ship.vz });
  const angle = ship.angle ?? 0;
  const bank = ship.bank ?? 0;
  const angularVelocity = ship.angularVelocity ?? 0;
  const thrust = ship.thrust ?? 0;
  if (![angle, bank, angularVelocity, thrust].every(Number.isFinite))
    throw new TypeError('Motion orientation and thrust must be finite');
  if (Math.abs(angularVelocity) > turnRate + 1e-8)
    throw new RangeError('Incoming angular velocity exceeds the motion spec');
  const state = {
    ...position,
    vx: current.x,
    vy: current.y,
    vz: current.z,
    angle,
    bank,
    angularVelocity,
    thrust,
  };
  if (dt === 0) return Object.freeze(state);
  if (command.stop)
    return Object.freeze({ ...state, vx: 0, vy: 0, vz: 0, angularVelocity: 0, thrust: 0 });
  const desired = finiteVector(command.velocity);

  // Attitude changes have inertia. Slow the turn before reaching the requested heading.
  const horizontalSpeed = Math.hypot(desired.x, desired.z);
  const commandScale = length(desired) > maxSpeed ? maxSpeed / length(desired) : 1;
  const desiredSpeed = horizontalSpeed * commandScale;
  const targetAngle = horizontalSpeed > 1e-5 ? Math.atan2(desired.x, -desired.z) : angle;
  const error = wrap(targetAngle - angle);
  const desiredTurn =
    Math.sign(error) *
    Math.min(turnRate, Math.abs(error) * 1.4, Math.sqrt(2 * angularAcceleration * Math.abs(error)));
  const nextTurn = approach(angularVelocity, desiredTurn, angularAcceleration * dt);
  const nextAngle = wrap(angle + (angularVelocity + nextTurn) * 0.5 * dt);
  const forward = { x: Math.sin(nextAngle), z: -Math.cos(nextAngle) };
  const forwardSpeed = current.x * forward.x + current.z * forward.z;

  // The main engines push along the hull. During a large turn, coast and let attitude catch up.
  const alignment = Math.max(0, Math.cos(wrap(targetAngle - nextAngle)));
  const requestedForwardSpeed = desiredSpeed * alignment * alignment;
  const forwardAcceleration = clamp(
    (requestedForwardSpeed - forwardSpeed) * 1.2,
    -acceleration * 0.75,
    acceleration,
  );
  const lateral = {
    x: current.x - forward.x * forwardSpeed,
    y: current.y - desired.y * commandScale,
    z: current.z - forward.z * forwardSpeed,
  };
  const lateralLength = length(lateral);
  const correction = lateralLength > 0 ? Math.min(1.1, (acceleration * 0.65) / lateralLength) : 0;
  const force = {
    x: forward.x * forwardAcceleration - lateral.x * correction,
    y: -lateral.y * correction,
    z: forward.z * forwardAcceleration - lateral.z * correction,
  };
  const forceLength = length(force);
  const forceScale = forceLength > acceleration ? acceleration / forceLength : 1;
  const velocity = {
    x: current.x + force.x * forceScale * dt,
    y: current.y + force.y * forceScale * dt,
    z: current.z + force.z * forceScale * dt,
  };
  const speed = length(velocity);
  if (speed > maxSpeed && speed > length(current)) {
    const scale = Math.max(maxSpeed, length(current)) / speed;
    velocity.x *= scale;
    velocity.y *= scale;
    velocity.z *= scale;
  }
  const requestedThrust =
    acceleration > 0 ? Math.max(0, (forwardAcceleration * forceScale) / acceleration) : 0;
  return Object.freeze({
    x: position.x + velocity.x * dt,
    y: position.y + velocity.y * dt,
    z: position.z + velocity.z * dt,
    vx: velocity.x,
    vy: velocity.y,
    vz: velocity.z,
    angle: nextAngle,
    bank: 0,
    angularVelocity: nextTurn,
    thrust: approach(thrust, requestedThrust, dt * 1.5),
  });
}

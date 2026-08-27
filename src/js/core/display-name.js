// Resolución de nombres humanos para peer IDs
// Prioridad: alias local > nick del evento > nick conocido > peer ID truncado

/**
 * Resuelve el nombre a mostrar para un peer_id
 * @param {string} peerId - Peer ID del usuario
 * @param {string} eventNick - Nick del evento (opcional)
 * @param {Object} knownNicks - Objeto con { nicks: {}, aliases: {} }
 * @returns {string} Nombre a mostrar
 */
export function displayName(peerId, eventNick, knownNicks) {
    // Alias local tiene máxima prioridad
    if (knownNicks?.aliases?.[peerId]) return knownNicks.aliases[peerId];
    // Nick del evento (del convoy actual)
    if (eventNick) return eventNick;
    // Nick conocido (almacenado de gossip anterior)
    if (knownNicks?.nicks?.[peerId]) return knownNicks.nicks[peerId];
    // Fallback: peer ID truncado
    if (peerId && peerId.length > 12) return peerId.slice(0, 6) + '…' + peerId.slice(-4);
    return peerId || '?';
}

/**
 * Trunca un peer ID para mostrar (formato: abc123…xyz9)
 * @param {string} peerId - Peer ID completo
 * @returns {string} Peer ID truncado
 */
export function truncPeer(peerId) {
    if (!peerId || peerId.length < 16) return peerId || '—';
    return peerId.slice(0, 8) + '…' + peerId.slice(-6);
}

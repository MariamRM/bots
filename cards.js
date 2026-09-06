function violetCard(altText, contents, size = 'kilo') {
  return {
    type: 'flex', altText,
    contents: {
      type: 'bubble', size,
      body: {
        type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'md',
        background: { type: 'linearGradient', angle: '125deg', startColor: '#C4B5FD88', endColor: '#6D28D9EE' },
        contents
      }
    }
  };
}

function greetingCard(name, admin = false) {
  const safeName = String(name || 'there').replace(/[\r\n\t]/g, ' ').slice(0, 60);
  const greeting = `Hey ${safeName}.`;
  return violetCard(admin ? `${greeting} Avi is active.` : greeting, [
    { type: 'text', text: greeting, size: 'lg', weight: 'bold', color: '#2E1065', wrap: true },
    ...(admin ? [{ type: 'text', text: 'Avi is active.', size: 'sm', color: '#2E1065', wrap: true }] : [])
  ], 'micro');
}

const button = (label, text) => ({ type: 'button', height: 'sm', style: 'secondary', action: { type: 'message', label, text } });

function adminCard(mainOwner = false) {
  return violetCard('AVI ADMIN — Seen Mode, Warnings, Members, Group Status, Protection', [
    { type: 'text', text: '🛡 AVI ADMIN', size: 'xl', weight: 'bold', color: '#2E1065' },
    button('👁 Seen Mode', '/avi seen'),
    button('⚠️ Warnings', '/avi warnings'),
    button('👥 Members', '/avi members'),
    button('📊 Group Status', '/avi status'),
    button('🔐 Protection', '/avi protection'),
    ...(mainOwner ? [button('🔑 Mini admins', '/avi admins')] : []),
    { type: 'text', text: 'LINE Membership\nInvite / Remove → Manage inside LINE', size: 'xs', color: '#FFFFFF', wrap: true }
  ]);
}

function seenCard(active) {
  return violetCard('Reader connection required', [
    { type: 'text', text: '👁 Reader Mode', size: 'lg', weight: 'bold', color: '#2E1065' },
    { type: 'text', text: 'Requires the separate logged-in reader account. Writing a message does not count as reading.', size: 'sm', color: '#2E1065', wrap: true },
    button('Turn ON', '/reader on'),
    button('Turn OFF', '/reader off'),
    button('Readers', '/reader list')
  ]);
}

module.exports = { greetingCard, adminCard, seenCard };

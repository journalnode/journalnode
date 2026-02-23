const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { airdropToWallet } = require('../wallet');
const { getActiveWallet } = require('../walletStore');
const { getUserPurpose, setUserPurpose } = require('../onboardStore');

const ONBOARD_AMOUNT = '50';
const ONBOARD_MEMO = 'Journal Node Onboarding';

module.exports = {
  name: 'onboard',
  description: 'Set your journal purpose/goal and receive a 50 PFT reward.',
  needsEntries: false,
  isModal: true,

  async showModal(interaction) {
    const userId = interaction.user.id;
    const existing = getUserPurpose(userId);

    const modal = new ModalBuilder()
      .setCustomId('onboard_modal')
      .setTitle('Journal Node Onboarding');

    const purposeInput = new TextInputBuilder()
      .setCustomId('purpose')
      .setLabel('Purpose or goal of your journal?')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('e.g. Track my fitness journey, write down my thoughts...')
      .setRequired(true)
      .setMaxLength(1000);

    if (existing) {
      purposeInput.setValue(existing.purpose);
    }

    modal.addComponents(new ActionRowBuilder().addComponents(purposeInput));
    await interaction.showModal(modal);
  },

  async handleSubmit(interaction) {
    await interaction.deferReply({ flags: 64 });

    const userId = interaction.user.id;
    const username = interaction.user.username;
    const purpose = interaction.fields.getTextInputValue('purpose');

    const existing = getUserPurpose(userId);
    const isUpdate = existing !== null;

    // Check wallet
    const active = getActiveWallet(userId);
    if (!active) {
      setUserPurpose(userId, purpose);
      await interaction.editReply(
        `**Purpose saved!** ${isUpdate ? '(Updated)' : ''}\n\n` +
        `**Your Journal Purpose:** ${purpose}\n\n` +
        'You don\'t have an active wallet yet, so the 50 PFT reward could not be sent. ' +
        'Use `/postfiat` to create a wallet, then run `/onboard` again to claim your reward.'
      );
      return;
    }

    // Save purpose
    setUserPurpose(userId, purpose);
    console.log(`[/onboard] ${username} ${isUpdate ? 'updated' : 'set'} purpose: ${purpose.slice(0, 80)}`);

    // Send 50 PFT reward
    try {
      const airdrop = await airdropToWallet(active.address, ONBOARD_AMOUNT, ONBOARD_MEMO);
      console.log(`[/onboard] Sent ${ONBOARD_AMOUNT} PFT to ${active.address} — tx: ${airdrop.txHash}`);

      const lines = [
        `**Purpose ${isUpdate ? 'Updated' : 'Saved'}!**\n`,
        `**Your Journal Purpose:** ${purpose}\n`,
        `**Reward:** ${ONBOARD_AMOUNT} PFT sent to your active wallet`,
        `**Transaction Link:** https://explorer.testnet.postfiat.org/transactions/${airdrop.txHash}`,
      ];

      await interaction.editReply(lines.join('\n'));
    } catch (err) {
      console.error(`[/onboard] Reward tx failed:`, err.message);
      await interaction.editReply(
        `**Purpose ${isUpdate ? 'Updated' : 'Saved'}!**\n\n` +
        `**Your Journal Purpose:** ${purpose}\n\n` +
        `The 50 PFT reward transaction failed: ${err.message}`
      );
    }
  },
};

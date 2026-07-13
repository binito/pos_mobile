/**
 * Formatação de números e datas
 */

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^﻿/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

function safeString(value, maxLength = 250) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseNumber(value) {
  const cleaned = String(value || '')
    .replace(/[€%\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeNext(value) {
  const next = String(value || '/');
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/api/')) {
    return '/';
  }
  return next;
}

module.exports = {
  roundMoney,
  normalizeHeader,
  safeString,
  parseNumber,
  sanitizeNext
};
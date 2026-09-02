(function (game) {
  var format = game.utils.format;
  var t = game.utils.i18n.t;
  var getText = game.utils.i18n.getDataText;

  function safe(value) {
    return format.escapeHtml(value === null || typeof value === "undefined" ? "" : String(value));
  }

  function asset(path) {
    return new URL(path, document.baseURI).href;
  }

  function getGenderLabel(cat) {
    return t(cat && cat.gender === "female" ? "gender_female" : "gender_male");
  }

  function getCatImage(cat, stage) {
    var imageUrl = stage
      ? game.utils.catArt.getCatStageUrl(cat)
      : game.utils.catArt.getCatSpriteUrl(cat);

    return imageUrl || game.utils.catArt.getCatStageUrl(cat);
  }

  function getSeverity(cat) {
    var health = Math.max(0, Number(cat && cat.health) || 0);
    var disease = cat && game.systems.catSystem.getCatDisease(cat);

    if (disease && health <= 35) {
      return { key: "hospital_urgent", className: "is-urgent", level: 4 };
    }
    if (disease && health <= 60) {
      return { key: "hospital_priority", className: "is-priority", level: 3 };
    }
    if (disease) {
      return { key: "hospital_observe", className: "is-observe", level: 2 };
    }
    if (health <= 55) {
      return { key: "hospital_observe", className: "is-observe", level: 1 };
    }
    return { key: "hospital_stable", className: "is-stable", level: 0 };
  }

  function getActiveCats(state) {
    return state.cats.filter(function (cat) {
      return cat.unlocked && cat.isAlive !== false;
    });
  }

  function getSickCats(state) {
    return getActiveCats(state)
      .filter(function (cat) {
        return !!cat.diseaseId && !!game.systems.catSystem.getCatDisease(cat);
      })
      .sort(function (first, second) {
        return (Number(first.health) || 0) - (Number(second.health) || 0);
      });
  }

  function getPatientQueue(state, sickCats) {
    var stableCats = getActiveCats(state)
      .filter(function (cat) {
        return !cat.diseaseId || !game.systems.catSystem.getCatDisease(cat);
      })
      .sort(function (first, second) {
        return (Number(first.health) || 0) - (Number(second.health) || 0);
      });

    return sickCats.concat(stableCats);
  }

  function getSelectedPatient(queue) {
    var selected = queue.find(function (cat) {
      return cat.id === game.state.selectedCatId;
    });

    return selected || queue[0] || null;
  }

  function getHealthAverage(cats) {
    if (!cats.length) {
      return 0;
    }

    return Math.round(
      cats.reduce(function (total, cat) {
        return total + (Number(cat.health) || 0);
      }, 0) / cats.length
    );
  }

  function renderSummaryStat(label, value, className) {
    return (
      '<div class="hospital-summary-stat ' + className + '">' +
      '<span>' + safe(label) + '</span><strong>' + safe(value) + '</strong>' +
      '</div>'
    );
  }

  function renderMeter(label, value, className) {
    var safeValue = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

    return (
      '<div class="hospital-meter ' + (className || "") + '">' +
      '<div class="hospital-meter-heading"><span>' + safe(label) + '</span><strong>' + safeValue + '%</strong></div>' +
      '<div class="hospital-meter-track"><span style="width:' + safeValue + '%"></span></div>' +
      '</div>'
    );
  }

  function renderQueueItem(cat, selected) {
    var disease = game.systems.catSystem.getCatDisease(cat);
    var severity = getSeverity(cat);
    var countdown = disease ? game.systems.catSystem.getDiseaseProgressCountdown(cat) : null;
    var name = getText(cat, "name");
    var stateLabel = disease ? t(severity.key) : t("hospital_stable");
    var detail = disease ? getText(disease, "name") : t("hospital_stable_state");
    var imageUrl = getCatImage(cat, false);
    var ariaLabel = name + " · " + detail + " · " + stateLabel;

    return (
      '<button type="button" class="hospital-queue-item ' + severity.className + (selected ? " is-selected" : "") +
      '" data-select-cat="' + safe(cat.id) + '" aria-pressed="' + (selected ? "true" : "false") +
      '" aria-label="' + safe(ariaLabel) + '">' +
      '<span class="hospital-queue-art"><img src="' + safe(imageUrl) + '" alt="" width="96" height="96" loading="lazy" decoding="async" /></span>' +
      '<span class="hospital-queue-copy">' +
      '<span class="hospital-queue-line"><span class="hospital-severity-dot" aria-hidden="true"></span><span class="hospital-queue-status">' +
      safe(stateLabel) + '</span><span class="hospital-queue-disease">' + safe(detail) + '</span></span>' +
      '<strong>' + safe(name) + '</strong>' +
      '<span class="hospital-queue-meta">' + safe(getGenderLabel(cat)) + ' · ' +
      safe(format.formatAgeYears(game.systems.catSystem.getCatAgeYears(cat))) + '</span>' +
      '<span class="hospital-queue-health"><span>' + safe(t("health_label")) + '</span><strong>' +
      Math.max(0, Math.min(100, Math.round(Number(cat.health) || 0))) + '%</strong></span>' +
      (disease
        ? '<span class="hospital-queue-timer">' + safe(t("next_worsen")) + ' · <span data-cat-disease-countdown data-cat-id="' +
          safe(cat.id) + '" aria-live="polite">' + safe(countdown === null ? t("stopped") : format.formatDuration(countdown)) + '</span></span>'
        : '<span class="hospital-queue-timer is-clear">' + safe(t("hospital_queue_ready")) + '</span>') +
      '</span></button>'
    );
  }

  function renderQueue(state, queue, selectedPatient, sickCats) {
    var activeCount = getActiveCats(state).length;
    var queueMarkup = queue.length
      ? queue
          .map(function (cat) {
            return renderQueueItem(cat, selectedPatient && cat.id === selectedPatient.id);
          })
          .join("")
      : '<div class="hospital-empty-queue"><strong>' + safe(t("hospital_queue_empty")) + '</strong><p>' +
        safe(t("hospital_queue_empty_copy")) + '</p></div>';

    return (
      '<aside class="hospital-queue-card" aria-labelledby="hospital-queue-title">' +
      '<div class="hospital-card-heading"><div><p class="section-eyebrow">' + safe(t("hospital_queue_label")) +
      '</p><h3 id="hospital-queue-title" class="panel-title">' + safe(t("hospital_queue_title")) +
      '</h3></div><span class="hospital-count-badge ' + (sickCats.length ? "is-alert" : "is-clear") + '">' +
      sickCats.length + '</span></div>' +
      '<p class="hospital-queue-sort">' + safe(t("hospital_queue_sort")) + '</p>' +
      '<div class="hospital-queue-list">' + queueMarkup + '</div>' +
      '<div class="hospital-queue-footer"><span>' + safe(t("hospital_queue_count", { current: queue.length, total: activeCount })) +
      '</span><span>' + safe(sickCats.length ? t("hospital_alert") : t("hospital_queue_all_clear")) + '</span></div>' +
      '</aside>'
    );
  }

  function renderPatientIdentity(cat, disease, statusKey) {
    var name = getText(cat, "name");
    var imageUrl = getCatImage(cat, true);

    return (
      '<div class="hospital-patient-hero">' +
      '<div class="hospital-patient-art"><img src="' + safe(imageUrl) + '" alt="' + safe(name) + '" width="280" height="280" decoding="async" /></div>' +
      '<div class="hospital-patient-summary">' +
      '<div class="hospital-patient-kicker"><p class="section-eyebrow">' + safe(t("hospital_current_patient")) +
      '</p><span class="status-pill ' + (disease ? "is-danger" : "is-success") + '">' + safe(t(statusKey)) + '</span></div>' +
      '<h3 id="hospital-patient-title" class="hospital-patient-name">' + safe(name) +
      '<span class="hospital-patient-gender"> · ' + safe(getGenderLabel(cat)) + '</span></h3>' +
      '<p class="hospital-patient-meta">' + safe(getText(cat, "breed")) + ' · ' + safe(t("age_label")) + ' ' +
      safe(format.formatAgeYears(game.systems.catSystem.getCatAgeYears(cat))) + '</p>' +
      (disease
        ? '<div class="hospital-symptom-box"><span>' + safe(t("hospital_patient_symptoms")) + '</span><strong>' +
          safe(getText(disease, "name")) + '</strong><p>' + safe(getText(disease, "description")) + '</p></div>'
        : '<div class="hospital-stable-box"><span>' + safe(t("hospital_patient_stable")) + '</span><strong>' +
          safe(t("hospital_patient_stable_copy")) + '</strong></div>') +
      '</div></div>'
    );
  }

  function renderSeverityMeter(severity, health) {
    var severityValue = severity.level * 25;
    var segments = [1, 2, 3, 4]
      .map(function (segment) {
        return '<span class="' + (segment <= severity.level ? "is-active" : "") + '"></span>';
      })
      .join("");

    return (
      '<div class="hospital-severity-card ' + severity.className + '">' +
      '<div class="hospital-fact-heading"><span>' + safe(t("hospital_case_severity")) + '</span><strong>' +
      safe(t(severity.key)) + '</strong></div>' +
      '<div class="hospital-severity-track" role="progressbar" aria-label="' + safe(t("hospital_case_severity")) +
      '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + severityValue + '">' + segments + '</div>' +
      '<small>' + safe(t("hospital_health_remaining", { value: Math.max(0, Math.min(100, Math.round(Number(health) || 0))) })) + '</small>' +
      '</div>'
    );
  }

  function renderSickPatient(state, cat, disease) {
    var severity = getSeverity(cat);
    var countdown = game.systems.catSystem.getDiseaseProgressCountdown(cat);
    var treatmentCost = Number(disease.treatmentCost) || 0;
    var canTreat = Number(state.player.gold) >= treatmentCost;
    var treatmentNote = canTreat ? t("hospital_treatment_note") : t("hospital_treatment_unavailable");

    return (
      '<article class="hospital-patient-card is-sick" aria-labelledby="hospital-patient-title">' +
      renderPatientIdentity(cat, disease, severity.key) +
      '<div class="hospital-case-row"><div class="hospital-case-summary"><span>' + safe(t("hospital_case_detail")) +
      '</span><strong>' + safe(getText(disease, "name")) + '</strong><p>' + safe(getText(disease, "description")) +
      '</p></div>' +
      renderSeverityMeter(severity, cat.health) +
      '<div class="hospital-countdown-card"><span>' + safe(t("next_worsen")) + '</span><strong><span data-cat-disease-countdown data-cat-id="' +
      safe(cat.id) + '" aria-live="polite">' + safe(countdown === null ? t("stopped") : format.formatDuration(countdown)) +
      '</span></strong><small>' + safe(t("hospital_worsen_hint")) + '</small></div></div>' +
      '<div class="hospital-fact-grid"><div class="hospital-fact is-cost"><span>' + safe(t("disease_cost")) +
      '</span><strong>' + safe(format.formatNumber(treatmentCost)) + ' ' + safe(t("gold_unit")) + '</strong></div>' +
      '<div class="hospital-fact is-health"><span>' + safe(t("hospital_health_recovery")) + '</span><strong>+12</strong></div>' +
      '<div class="hospital-fact is-mood"><span>' + safe(t("hospital_mood_recovery")) + '</span><strong>+6</strong></div>' +
      '<div class="hospital-fact is-contagious"><span>' + safe(t("contagious_label")) + '</span><strong>' +
      safe(disease.contagious ? t("contagious_yes") : t("contagious_no")) + '</strong></div></div>' +
      '<div class="hospital-treatment-panel"><div><p class="section-eyebrow">' + safe(t("hospital_treatment_label")) +
      '</p><p class="hospital-treatment-copy">' + safe(treatmentNote) + '</p></div><div class="hospital-treatment-action">' +
      '<button type="button" class="primary-button hospital-treat-button" data-treat-cat="' + safe(cat.id) + '"' +
      (canTreat ? "" : " disabled") + '><span>' + safe(t("treat_now")) + '</span><strong>' + safe(format.formatNumber(treatmentCost)) +
      ' ' + safe(t("gold_unit")) + '</strong></button>' +
      (!canTreat ? '<button type="button" class="secondary-button hospital-work-button" data-page-target="work">' + safe(t("go_work")) + '</button>' : "") +
      '</div></div></article>'
    );
  }

  function renderStablePatient(cat) {
    var health = Math.max(0, Math.min(100, Math.round(Number(cat.health) || 0)));
    var mood = Math.max(0, Math.min(100, Math.round(Number(cat.mood) || 0)));

    return (
      '<article class="hospital-patient-card is-stable" aria-labelledby="hospital-patient-title">' +
      renderPatientIdentity(cat, null, "hospital_stable") +
      '<div class="hospital-stable-summary"><div><p class="section-eyebrow">' + safe(t("hospital_stable_snapshot")) +
      '</p><h4>' + safe(t("hospital_stable_snapshot_title")) + '</h4><p class="page-copy">' + safe(t("hospital_stable_snapshot_copy")) +
      '</p></div><div class="hospital-stable-meters">' + renderMeter(t("health_label"), health, "is-health") +
      renderMeter(t("mood_label"), mood, "is-mood") + '</div></div>' +
      '<div class="hospital-stable-footer"><p class="helper-text">' + safe(t("hospital_stable_footer")) +
      '</p><button type="button" class="secondary-button" data-page-target="cats" data-select-cat="' + safe(cat.id) + '">' +
      safe(t("hospital_view_profile")) + '</button></div></article>'
    );
  }

  function renderNoPatient() {
    return (
      '<article class="hospital-patient-card hospital-no-patient" aria-labelledby="hospital-patient-title">' +
      '<div class="hospital-no-patient-copy"><span class="hospital-no-patient-mark" aria-hidden="true">醫</span>' +
      '<p class="section-eyebrow">' + safe(t("hospital_current_patient")) + '</p><h3 id="hospital-patient-title" class="panel-title">' +
      safe(t("hospital_empty")) + '</h3><p class="page-copy">' + safe(t("hospital_empty_copy")) + '</p></div>' +
      '<img src="' + safe(asset("src/assets/shop/shop-med.jpg")) + '" alt="" width="800" height="600" loading="lazy" decoding="async" />' +
      '</article>'
    );
  }

  function renderPatientCard(state, selectedPatient) {
    var disease = selectedPatient ? game.systems.catSystem.getCatDisease(selectedPatient) : null;

    if (!selectedPatient) {
      return renderNoPatient();
    }
    if (disease) {
      return renderSickPatient(state, selectedPatient, disease);
    }
    return renderStablePatient(selectedPatient);
  }

  function renderBreedOptions(breedableCats, selectedIndex) {
    return breedableCats.length
      ? breedableCats
          .map(function (cat, index) {
            return '<option value="' + safe(cat.id) + '"' + (index === selectedIndex ? ' selected' : '') + '>' +
              safe(getText(cat, "name")) + ' · ' + safe(getGenderLabel(cat)) + '</option>';
          })
          .join("")
      : '<option value="">' + safe(t("breed_pick_two")) + '</option>';
  }

  function renderPairPreview(cat, fallbackLabel) {
    if (!cat) {
      return '<div class="hospital-pair-placeholder"><span>' + safe(fallbackLabel) + '</span></div>';
    }

    return (
      '<div class="hospital-pair-slot"><img src="' + safe(getCatImage(cat, false)) + '" alt="" width="52" height="52" loading="lazy" decoding="async" />' +
      '<strong>' + safe(getText(cat, "name")) + '</strong></div>'
    );
  }

  function renderPairingCard(breedableCats) {
    var firstParentOptions = renderBreedOptions(breedableCats, 0);
    var secondParentOptions = renderBreedOptions(breedableCats, 1);
    var canBreed = breedableCats.length >= 2;

    return (
      '<section class="hospital-side-card hospital-pairing-card" role="group" aria-labelledby="hospital-pairing-title">' +
      '<div class="hospital-card-heading"><div><p class="section-eyebrow">' + safe(t("hospital_pairing_label")) +
      '</p><h3 id="hospital-pairing-title" class="panel-title">' + safe(t("breed_panel_title")) + '</h3></div>' +
      '<span class="hospital-side-index">02</span></div>' +
      '<p class="page-copy hospital-side-copy">' + safe(t("breed_panel_copy")) + '</p>' +
      '<div class="hospital-pair-preview" aria-hidden="true">' + renderPairPreview(breedableCats[0], t("breed_parent_a")) +
      '<span class="hospital-pair-connector">+</span>' + renderPairPreview(breedableCats[1], t("breed_parent_b")) + '</div>' +
      '<div class="hospital-pair-fields"><label><span>' + safe(t("breed_parent_a")) + '</span><select id="breed-parent-a" class="field">' +
      firstParentOptions + '</select></label><label><span>' + safe(t("breed_parent_b")) + '</span><select id="breed-parent-b" class="field">' +
      secondParentOptions + '</select></label></div>' +
      '<button type="button" class="secondary-button hospital-pair-button" data-breed-cats' + (canBreed ? "" : " disabled") + '>' +
      safe(t("breed_action")) + '</button><p class="helper-text hospital-side-helper">' + safe(t("breed_hint")) + '</p>' +
      '</section>'
    );
  }

  function renderPregnancyCard(pregnantCats) {
    var markup = pregnantCats.length
      ? pregnantCats
          .map(function (cat) {
            var countdown = game.systems.collectionSystem.getPregnancyCountdown(cat);
            return (
              '<div class="hospital-pregnancy-item"><img src="' + safe(getCatImage(cat, false)) + '" alt="" width="58" height="58" loading="lazy" decoding="async" />' +
              '<div><strong>' + safe(getText(cat, "name")) + '</strong><span>' + safe(t("pregnancy_active")) + '</span><small>' +
              safe(t("pregnancy_due")) + ' · <span data-pregnancy-countdown data-cat-id="' + safe(cat.id) + '" aria-live="polite">' +
              safe(countdown === null ? t("stopped") : format.formatDuration(countdown)) + '</span></small></div></div>'
            );
          })
          .join("")
      : '<div class="hospital-pregnancy-empty"><strong>' + safe(t("pregnancy_status")) + '</strong><p>' + safe(t("pregnancy_none")) + '</p></div>';

    return (
      '<section class="hospital-side-card hospital-pregnancy-card" role="group" aria-labelledby="hospital-pregnancy-title">' +
      '<div class="hospital-card-heading"><div><p class="section-eyebrow">' + safe(t("hospital_pregnancy_label")) +
      '</p><h3 id="hospital-pregnancy-title" class="panel-title">' + safe(t("pregnancy_status")) + '</h3></div>' +
      '<span class="hospital-side-index">03</span></div><div class="hospital-pregnancy-list">' + markup + '</div></section>'
    );
  }

  function renderDiseaseGuide() {
    return (
      '<section class="hospital-side-card hospital-guide-card" role="group" aria-labelledby="hospital-guide-title">' +
      '<div class="hospital-card-heading"><div><p class="section-eyebrow">' + safe(t("disease_manual")) +
      '</p><h3 id="hospital-guide-title" class="panel-title">' + safe(t("hospital_guide_title")) + '</h3></div>' +
      '<span class="hospital-side-index">04</span></div>' +
      '<div class="hospital-guide-intro"><img src="' + safe(asset("src/assets/shop/shop-med.jpg")) + '" alt="" width="800" height="600" loading="lazy" decoding="async" />' +
      '<p>' + safe(t("hospital_guide_copy")) + '</p></div>' +
      '<div class="hospital-disease-list">' +
      game.data.diseases
        .map(function (disease, index) {
          return (
            '<article class="hospital-disease-item"><span class="hospital-disease-number">' + String(index + 1).padStart(2, "0") + '</span><div>' +
            '<strong>' + safe(getText(disease, "name")) + '</strong><p>' + safe(getText(disease, "description")) + '</p>' +
            '<small>' + safe(t("disease_cost")) + ' · ' + safe(format.formatNumber(disease.treatmentCost)) + ' ' + safe(t("gold_unit")) +
            ' · ' + safe(disease.contagious ? t("contagious_yes") : t("contagious_no")) + '</small></div></article>'
          );
        })
        .join("") +
      '</div></section>'
    );
  }

  function renderHospitalPanel(state) {
    var activeCats = getActiveCats(state);
    var sickCats = getSickCats(state);
    var patientQueue = getPatientQueue(state, sickCats);
    var selectedPatient = getSelectedPatient(patientQueue);
    var breedableCats = game.systems.collectionSystem.getBreedableCats();
    var pregnantCats = game.systems.collectionSystem.getPregnantCats();
    var healthAverage = getHealthAverage(activeCats);
    var alertClass = sickCats.length ? "is-alert" : "is-clear";

    return (
      '<section class="hospital-page" aria-labelledby="hospital-page-title">' +
      '<header class="hospital-page-header"><div class="hospital-page-heading"><div class="hospital-page-title-row"><span class="hospital-page-mark" aria-hidden="true">醫</span>' +
      '<div><p class="section-eyebrow">' + safe(t("hospital_triage_kicker")) + '</p><h2 id="hospital-page-title" class="page-title">' +
      safe(t("hospital_triage_title")) + '</h2><p class="page-copy">' + safe(t("hospital_triage_copy")) + '</p></div></div></div>' +
      '<div class="hospital-summary-strip">' + renderSummaryStat(t("hospital_overall_health"), healthAverage + "%", "is-health") +
      renderSummaryStat(t("hospital_case_count"), sickCats.length, "is-alert") + renderSummaryStat(t("hospital_visits_label"), state.player.hospitalVisits || 0, "is-visits") +
      '</div></header>' +
      '<div class="hospital-alert-ribbon ' + alertClass + '"><span class="hospital-ribbon-label">' + safe(t("hospital_alert")) +
      '</span><strong>' + safe(sickCats.length ? t("hospital_alert_copy", { count: sickCats.length }) : t("hospital_empty_copy")) +
      '</strong><span class="hospital-ribbon-note">' + safe(t("hospital_ribbon_note")) + '</span></div>' +
      '<section class="hospital-triage-layout" aria-label="' + safe(t("hospital_triage_title")) + '">' +
      renderQueue(state, patientQueue, selectedPatient, sickCats) +
      '<div class="hospital-exam-column">' + renderPatientCard(state, selectedPatient) + '</div>' +
      '<aside class="hospital-side-rail">' + renderPairingCard(breedableCats) + renderPregnancyCard(pregnantCats) + renderDiseaseGuide() + '</aside>' +
      '</section>' +
      '<footer class="hospital-desk-footer"><span class="hospital-desk-stamp">' + safe(t("hospital_desk_stamp")) +
      '</span><p>' + safe(t("hospital_footer_note")) + '</p><span>' + safe(t("hospital_desk_status")) + '</span></footer>' +
      '</section>'
    );
  }

  game.ui.renderHospitalPanel = renderHospitalPanel;
})(window.CatGame);

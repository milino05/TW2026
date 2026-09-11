function strings(values = []) {
  return (values || []).map(String);
}

function intersects(left = [], right = []) {
  if (!left.length || !right.length) return false;
  const wanted = new Set(strings(right));
  return strings(left).some((value) => wanted.has(value));
}

function sideCompatible(subjectClasses = [], allowedClasses = []) {
  return !subjectClasses.length || !allowedClasses.length || intersects(subjectClasses, allowedClasses);
}

export function relationViews(relationTypes = []) {
  const result = [];
  for (const relation of relationTypes || []) {
    const direct = {
      viewKey: String(relation.key || relation.definitionId || ""),
      relationTypeDefinitionId: String(relation.definitionId || ""),
      direction: relation.directionality === "symmetric" ? "symmetric" : "direct",
      label: relation.label || relation.key || relation.definitionId,
      description: relation.description || "",
      focusDefinitionIds: strings(relation.domainDefinitionIds),
      otherDefinitionIds: strings(relation.rangeDefinitionIds),
      relation,
    };
    result.push(direct);
    if (relation.directionality !== "symmetric" && relation.reverse?.label) {
      result.push({
        viewKey: `${String(relation.key || relation.definitionId || "")}:reverse`,
        relationTypeDefinitionId: String(relation.definitionId || ""),
        direction: "reverse",
        label: relation.reverse.label,
        description: relation.reverse.description || "",
        focusDefinitionIds: strings(relation.rangeDefinitionIds),
        otherDefinitionIds: strings(relation.domainDefinitionIds),
        relation,
      });
    }
  }
  return result;
}

export function compatibleRelationViews(relationTypes = [], focusClassIds = [], otherClassIds = null) {
  return relationViews(relationTypes).filter((view) => {
    if (!sideCompatible(focusClassIds, view.focusDefinitionIds)) return false;
    if (otherClassIds === null) return true;
    return sideCompatible(otherClassIds, view.otherDefinitionIds);
  });
}

export function canonicalEndpoints(view, focusSubjectId, otherSubjectId) {
  if (view?.direction === "reverse") {
    return { sourceSubjectId: otherSubjectId, targetSubjectId: focusSubjectId };
  }
  return { sourceSubjectId: focusSubjectId, targetSubjectId: otherSubjectId };
}

export function edgeViewForFocus(edge, relation, focusSubjectId) {
  if (!edge || !relation) return null;
  const focus = String(focusSubjectId || "");
  const source = String(edge.sourceSubjectId?._id || edge.sourceSubjectId || "");
  const target = String(edge.targetSubjectId?._id || edge.targetSubjectId || "");
  if (relation.directionality === "symmetric") {
    return {
      direction: "symmetric",
      label: relation.label || relation.key || relation.definitionId,
      otherSubjectId: source === focus ? target : source,
    };
  }
  if (source === focus) {
    return {
      direction: "direct",
      label: relation.label || relation.key || relation.definitionId,
      otherSubjectId: target,
    };
  }
  return {
    direction: "reverse",
    label: relation.reverse?.label || relation.label || relation.key || relation.definitionId,
    otherSubjectId: source,
  };
}

export function classesNeeded(existingClassIds = [], allowedClassIds = []) {
  const existing = strings(existingClassIds);
  const allowed = strings(allowedClassIds);
  if (!allowed.length || intersects(existing, allowed)) return [];
  return allowed;
}

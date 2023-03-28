import { ContentTypeProps, EntryProps } from 'contentful-management/types';

import { CollectionItem, SysProps, MessageAction, EntryReferenceMap, Entity } from '../types';
import { sendMessageToEditor } from '../utils';
import { isPrimitiveField, logUnrecognizedFields } from './utils';

/**
 * Updates GraphQL response data based on CMA entry object
 *
 * @param contentType ContentTypeProps
 * @param data Entity - The GraphQL response to be updated
 * @param update EntryProps - CMA entry object containing the update
 * @param locale string - Locale code
 * @returns Entity - Updated GraphQL response data
 */
export function updateEntry(
  contentType: ContentTypeProps,
  data: Entity & { sys: SysProps },
  update: EntryProps,
  locale: string,
  entityReferenceMap: EntryReferenceMap
): Entity & { sys: SysProps } {
  const modified = { ...data };
  const { fields } = contentType;

  logUnrecognizedFields(
    fields.map((f) => f.apiName ?? f.name),
    data
  );

  if (modified.sys.id !== update.sys.id) {
    return modified;
  }

  for (const field of fields) {
    const name = field.apiName ?? field.name;

    if (isPrimitiveField(field)) {
      updatePrimitiveField(modified, update, name, locale);
    } else if (field.type === 'RichText') {
      updateRichTextField(modified, update, name, locale);
    } else if (field.type === 'Link') {
      updateSingleRefField(modified, update, name, locale, entityReferenceMap);
    } else if (field.type === 'Array' && field.items?.type === 'Link') {
      updateMultiRefField(modified, update, name, locale, entityReferenceMap);
    }
  }

  return modified;
}

function updatePrimitiveField(modified: Entity, update: EntryProps, name: string, locale: string) {
  if (name in modified) {
    modified[name] = update.fields?.[name]?.[locale] ?? null;
  }
}

function updateRichTextField(modified: Entity, update: EntryProps, name: string, locale: string) {
  if (name in modified) {
    if (!modified[name]) {
      modified[name] = {};
    }
    (modified[name] as { json: unknown }).json = update?.fields?.[name]?.[locale] ?? null;
  }
}

function getContentTypenameFromEntityReferenceMap(
  referenceMap: EntryReferenceMap,
  entityId?: string
) {
  if (referenceMap && entityId) {
    const entity = referenceMap.get(entityId);
    if (entity) {
      const contentTypeId = entity.sys.contentType?.sys.id;
      const typename = contentTypeId.charAt(0).toUpperCase() + contentTypeId.slice(1);
      return typename;
    }
  }
}

function updateReferenceField(
  updatedReference: EntryProps & { __typename?: string },
  entityReferenceMap: EntryReferenceMap
) {
  // if the reference was deleted return null
  if (updatedReference === null) {
    return null;
  }

  // it's already in graphql format so we can return
  if (updatedReference.__typename) {
    return updatedReference;
  }

  const entityTypename = getContentTypenameFromEntityReferenceMap(
    entityReferenceMap,
    updatedReference.sys.id
  );
  // if we have the typename of the updated reference, we can return with it
  if (entityTypename) {
    return { ...updatedReference, __typename: entityTypename };
  } else {
    // if we don't have the typename we send a message back to the entry editor
    // and it will then send the reference back in the entity reference map
    // where we can calculate the typename on the next update message.
    sendMessageToEditor(MessageAction.ENTITY_NOT_KNOWN, {
      referenceEntityId: updatedReference.sys.id,
    });
    return null;
  }
}

function updateSingleRefField(
  dataFromPreviewApp: Entity,
  updateFromEntryEditor: EntryProps,
  name: string,
  locale: string,
  entityReferenceMap: EntryReferenceMap
) {
  if (name in dataFromPreviewApp) {
    const updatedReference = updateFromEntryEditor?.fields?.[name]?.[locale] ?? null;
    dataFromPreviewApp[name] = updateReferenceField(updatedReference, entityReferenceMap);
  }
}

function updateMultiRefField(
  dataFromPreviewApp: Entity,
  updateFromEntryEditor: EntryProps,
  name: string,
  locale: string,
  entityReferenceMap: EntryReferenceMap
) {
  const fieldName = `${name}Collection`;
  if (fieldName in dataFromPreviewApp) {
    const dataFromPreviewAppItems =
      updateFromEntryEditor?.fields?.[name]?.[locale]
        .map((dataFromPreviewAppItem: any) => {
          return updateReferenceField(
            dataFromPreviewAppItem as unknown as EntryProps,
            entityReferenceMap
          );
        })
        .filter(Boolean) ?? [];
    (dataFromPreviewApp[fieldName] as { items: CollectionItem[] }).items = dataFromPreviewAppItems;
  }
}
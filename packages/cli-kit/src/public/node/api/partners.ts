import {graphqlRequest, GraphQLVariables, GraphQLResponse} from './graphql.js'
import {partnersFqdn} from '../context/fqdn.js'
import {setDeprecatingSoon, setDeprecationDates} from '../../../private/node/context/deprecations-store.js'
import {gql} from 'graphql-request'

/**
 * Executes a GraphQL query against the Partners API.
 *
 * @param query - GraphQL query to execute.
 * @param token - Partners token.
 * @param variables - GraphQL variables to pass to the query.
 * @returns The response of the query of generic type <T>.
 */
export async function partnersRequest<T>(query: string, token: string, variables?: GraphQLVariables): Promise<T> {
  const api = 'Partners'
  const fqdn = await partnersFqdn()
  const url = `https://${fqdn}/api/cli/graphql`
  return graphqlRequest({
    query,
    api,
    url,
    token,
    variables,
    responseOptions: {onResponse: handleDeprecations},
  })
}

interface ProxyResponse {
  scriptServiceProxy: string
}

/**
 * Function queries are proxied through the script service proxy.
 * To execute a query, we encapsulate it inside another query (including the variables)
 * This is done automatically, you just need to provide the query and the variables.
 *
 * @param apiKey - APIKey of the app where the query will be executed.
 * @param query - GraphQL query to execute.
 * @param token - Partners token.
 * @param variables - GraphQL variables to pass to the query.
 * @returns The response of the query.
 */
export async function functionProxyRequest<T>(
  apiKey: string,
  query: unknown,
  token: string,
  variables?: unknown,
): Promise<T> {
  const proxyVariables = {
    api_key: apiKey,
    query,
    variables: JSON.stringify(variables) || '{}',
  }
  const proxyQuery = ScriptServiceProxyQuery
  const res: ProxyResponse = await partnersRequest(proxyQuery, token, proxyVariables)
  const json = JSON.parse(res.scriptServiceProxy)
  handleDeprecations(json)
  return json as T
}

const ScriptServiceProxyQuery = gql`
  query ProxyRequest($api_key: String, $query: String!, $variables: String) {
    scriptServiceProxy(apiKey: $api_key, query: $query, variables: $variables)
  }
`

interface Deprecation {
  supportedUntilDate?: string
  deprecatingSoon?: boolean
}

interface WithDeprecations {
  deprecations: Deprecation[]
}

/**
 * Sets the next deprecation date from [GraphQL response extensions](https://www.apollographql.com/docs/resources/graphql-glossary/#extensions)
 * if `response.extensions.deprecations` objects contain a `supportedUntilDate` (ISO 8601-formatted string).
 *
 * @param response - The response of the query.
 */
export function handleDeprecations<T>(response: GraphQLResponse<T>): void {
  if (!response.extensions) return

  const deprecationDates: Date[] = []
  let isDeprecatingSoon = false
  for (const deprecation of (response.extensions as WithDeprecations).deprecations) {
    if (deprecation.supportedUntilDate) {
      deprecationDates.push(new Date(deprecation.supportedUntilDate))
    } else if (deprecation.deprecatingSoon) {
      isDeprecatingSoon = true
      break
    }
  }

  if (isDeprecatingSoon) {
    setDeprecatingSoon()
  } else {
    setDeprecationDates(deprecationDates)
  }
}
